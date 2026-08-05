import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import {
  NOTIFICATION_ACTION_STATE,
  adminReclamationGroupingKey,
  staffReclamationGroupingKey,
  type ReclamationSummaryCounts,
} from "@/lib/notifications/action-state";
import { storeNotificationMessage, storeNotificationTitle } from "@/lib/notifications/i18n-storage";
import { buildSummaryFingerprint } from "@/lib/notifications/summary-fingerprint";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { RECLAMATION_EXCLUDED_SALES_STAGES } from "./constants";
import { getCollaborativeCustomerIds } from "./collaborative";
import {
  buildRiskEpisodeKey,
  getAutomaticReclaimRuleState,
  getReclaimRuleVersion,
} from "./reclaim-rule-version";
import {
  aggregateRiskCounts,
  isCustomerAtReclamationRisk,
  type ReclamationRiskSnapshot,
} from "./risk-snapshot";

export const RECLAMATION_EXPIRE_REASON = {
  autoReclaimed: "auto_reclaimed",
  transferred: "transferred",
  claimed: "claimed",
  excluded: "excluded",
  ruleExtended: "rule_extended",
  cycleReplaced: "cycle_replaced",
  archived: "archived",
} as const;

export type ReclamationExpireReason =
  (typeof RECLAMATION_EXPIRE_REASON)[keyof typeof RECLAMATION_EXPIRE_REASON];

type SnapshotWithEpisode = ReclamationRiskSnapshot & {
  riskEpisodeKey: string;
};

async function listActiveAdminUserIds(db: Database): Promise<string[]> {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(eq(schema.users.role, "admin"), eq(schema.users.isActive, 1)),
    );
  return rows.map((row) => row.id);
}

async function listEligibleCustomers(db: Database): Promise<Customer[]> {
  return db
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.status, "active"),
        isNotNull(schema.customers.ownerId),
        eq(schema.customers.isPinned, 0),
        notInArray(
          schema.customers.salesStage,
          [...RECLAMATION_EXCLUDED_SALES_STAGES],
        ),
      ),
    );
}

export async function collectReclamationRiskSnapshots(
  db: Database,
  now: Date = new Date(),
): Promise<ReclamationRiskSnapshot[]> {
  const settings = await getEffectiveSettings(db);
  const customers = await listEligibleCustomers(db);
  const collaborativeIds = await getCollaborativeCustomerIds(
    db,
    customers.map((customer) => customer.id),
  );

  const snapshots: ReclamationRiskSnapshot[] = [];
  for (const customer of customers) {
    if (collaborativeIds.has(customer.id)) {
      continue;
    }
    const snapshot = isCustomerAtReclamationRisk(customer, settings, now);
    if (snapshot) {
      snapshots.push(snapshot);
    }
  }
  return snapshots;
}

async function attachRiskEpisodeKeys(
  db: Database,
  snapshots: ReclamationRiskSnapshot[],
): Promise<SnapshotWithEpisode[]> {
  const { ruleVersion } = await getAutomaticReclaimRuleState(db);
  return snapshots.map((snapshot) => ({
    ...snapshot,
    riskEpisodeKey: buildRiskEpisodeKey({
      customerId: snapshot.customerId,
      ownerId: snapshot.ownerId,
      cycleStartedAt: snapshot.cycleStartedAt,
      reclaimDays: snapshot.reclaimDays,
      reclaimRuleVersion: ruleVersion,
    }),
  }));
}

async function upsertPendingActionItem(
  db: Database,
  snapshot: SnapshotWithEpisode,
  nowIso: string,
): Promise<void> {
  const existing = await db
    .select()
    .from(schema.reclamationActionItems)
    .where(
      eq(schema.reclamationActionItems.riskEpisodeKey, snapshot.riskEpisodeKey),
    )
    .limit(1);

  const row = existing[0];
  if (row?.actionState === "completed" || row?.actionState === "expired") {
    return;
  }

  if (row) {
    await db
      .update(schema.reclamationActionItems)
      .set({
        actionState: "pending",
        riskBand: snapshot.riskBand,
        idleDays: snapshot.idleDays,
        reclaimDaysSnapshot: snapshot.reclaimDays,
        updatedAt: nowIso,
      })
      .where(eq(schema.reclamationActionItems.id, row.id));
    return;
  }

  await db.insert(schema.reclamationActionItems).values({
    id: crypto.randomUUID(),
    userId: snapshot.ownerId,
    customerId: snapshot.customerId,
    cycleStartedAt: snapshot.cycleStartedAt,
    riskEpisodeKey: snapshot.riskEpisodeKey,
    actionState: "pending",
    riskBand: snapshot.riskBand,
    idleDays: snapshot.idleDays,
    reclaimDaysSnapshot: snapshot.reclaimDays,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

async function expireStalePendingItems(
  db: Database,
  activeEpisodeKeys: Set<string>,
  nowIso: string,
  reason: ReclamationExpireReason,
): Promise<void> {
  const pending = await db
    .select()
    .from(schema.reclamationActionItems)
    .where(eq(schema.reclamationActionItems.actionState, "pending"));

  for (const item of pending) {
    if (!activeEpisodeKeys.has(item.riskEpisodeKey)) {
      await db
        .update(schema.reclamationActionItems)
        .set({
          actionState: "expired",
          expiredAt: nowIso,
          expireReason: reason,
          updatedAt: nowIso,
        })
        .where(eq(schema.reclamationActionItems.id, item.id));
    }
  }
}

function buildStaffSummaryMessageParams(
  counts: ReclamationSummaryCounts,
): Record<string, string> {
  const urgentCount = counts.tomorrowCount + counts.within7Count;
  return {
    count: String(counts.totalCount),
    urgentCount: String(urgentCount),
    tomorrowCount: String(counts.tomorrowCount),
    within7Count: String(counts.within7Count),
    within14Count: String(counts.within14Count),
    routineCount: String(counts.routineCount),
    earliestReleaseAt: counts.earliestReleaseAt ?? "",
  };
}

function buildAdminSummaryMessageParams(
  counts: ReclamationSummaryCounts,
): Record<string, string> {
  const urgentCount = counts.tomorrowCount + counts.within7Count;
  return {
    count: String(counts.totalCount),
    urgentCount: String(urgentCount),
    memberCount: String(counts.memberCount ?? 0),
    tomorrowCount: String(counts.tomorrowCount),
    within7Count: String(counts.within7Count),
    earliestReleaseAt: counts.earliestReleaseAt ?? "",
  };
}

async function upsertSummaryNotification(
  db: Database,
  input: {
    userId: string;
    type: "reclamation.summary.staff" | "reclamation.summary.admin";
    groupingKey: string;
    summaryScope: "staff_self" | "admin_team";
    titleKey: string;
    messageKey: string;
    messageParams: Record<string, string>;
    counts: ReclamationSummaryCounts;
    riskEpisodeKeys: string[];
    nowIso: string;
    hasPendingCustomers: boolean;
  },
): Promise<void> {
  const fingerprint = buildSummaryFingerprint({
    summaryScope: input.summaryScope,
    recipientUserId: input.userId,
    riskEpisodeKeys: input.riskEpisodeKeys,
    counts: input.counts,
  });
  const title = storeNotificationTitle(input.titleKey);
  const message = storeNotificationMessage(input.messageKey, input.messageParams);

  const pendingRows = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, input.userId),
        eq(schema.notifications.groupingKey, input.groupingKey),
        eq(schema.notifications.actionState, NOTIFICATION_ACTION_STATE.pending),
      ),
    )
    .limit(1);

  if (!input.hasPendingCustomers) {
    if (pendingRows[0]) {
      await db
        .update(schema.notifications)
        .set({
          actionState: NOTIFICATION_ACTION_STATE.completed,
          actionUpdatedAt: input.nowIso,
          title,
          message,
          summaryFingerprint: fingerprint,
        })
        .where(eq(schema.notifications.id, pendingRows[0].id));
    }
    return;
  }

  if (pendingRows[0]) {
    const fingerprintChanged =
      pendingRows[0].summaryFingerprint !== fingerprint;
    await db
      .update(schema.notifications)
      .set({
        title,
        message,
        summaryFingerprint: fingerprint,
        actionUpdatedAt: input.nowIso,
        type: input.type,
        ...(fingerprintChanged ? { isRead: 0 } : {}),
      })
      .where(eq(schema.notifications.id, pendingRows[0].id));
    return;
  }

  await db.insert(schema.notifications).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    type: input.type,
    title,
    message,
    relatedEntityType: "reclamation_summary",
    relatedEntityId: input.summaryScope,
    isRead: 0,
    actionState: NOTIFICATION_ACTION_STATE.pending,
    groupingKey: input.groupingKey,
    actionUpdatedAt: input.nowIso,
    summaryScope: input.summaryScope,
    summaryFingerprint: fingerprint,
    createdAt: input.nowIso,
  });
}

export async function syncReclamationWorkItems(
  db: Database,
  now: Date = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  const snapshots = await attachRiskEpisodeKeys(
    db,
    await collectReclamationRiskSnapshots(db, now),
  );
  const activeEpisodeKeys = new Set<string>();

  for (const snapshot of snapshots) {
    activeEpisodeKeys.add(snapshot.riskEpisodeKey);
    await upsertPendingActionItem(db, snapshot, nowIso);
  }

  await expireStalePendingItems(
    db,
    activeEpisodeKeys,
    nowIso,
    RECLAMATION_EXPIRE_REASON.ruleExtended,
  );

  const byOwner = new Map<string, SnapshotWithEpisode[]>();
  for (const snapshot of snapshots) {
    const list = byOwner.get(snapshot.ownerId) ?? [];
    list.push(snapshot);
    byOwner.set(snapshot.ownerId, list);
  }

  for (const [ownerId, ownerSnapshots] of byOwner) {
    const counts = aggregateRiskCounts(ownerSnapshots);
    const isFinalUrgent = counts.tomorrowCount > 0;
    await upsertSummaryNotification(db, {
      userId: ownerId,
      type: "reclamation.summary.staff",
      groupingKey: staffReclamationGroupingKey(ownerId),
      summaryScope: "staff_self",
      titleKey: isFinalUrgent
        ? "notificationTypes.reclamation_summary_staff_urgent"
        : "notificationTypes.reclamation_summary_staff",
      messageKey: isFinalUrgent
        ? "notificationMessages.reclamationSummaryStaffUrgent"
        : "notificationMessages.reclamationSummaryStaff",
      messageParams: buildStaffSummaryMessageParams(counts),
      counts,
      riskEpisodeKeys: ownerSnapshots.map((snapshot) => snapshot.riskEpisodeKey),
      nowIso,
      hasPendingCustomers: counts.totalCount > 0,
    });
  }

  const staffOwnerIds = new Set(byOwner.keys());
  const allStaffIds = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.role, "staff"), eq(schema.users.isActive, 1)));

  const emptyCounts: ReclamationSummaryCounts = {
    totalCount: 0,
    tomorrowCount: 0,
    within7Count: 0,
    within14Count: 0,
    routineCount: 0,
    earliestReleaseAt: null,
  };

  for (const staff of allStaffIds) {
    if (staffOwnerIds.has(staff.id)) continue;
    await upsertSummaryNotification(db, {
      userId: staff.id,
      type: "reclamation.summary.staff",
      groupingKey: staffReclamationGroupingKey(staff.id),
      summaryScope: "staff_self",
      titleKey: "notificationTypes.reclamation_summary_staff",
      messageKey: "notificationMessages.reclamationSummaryStaff",
      messageParams: buildStaffSummaryMessageParams(emptyCounts),
      counts: emptyCounts,
      riskEpisodeKeys: [],
      nowIso,
      hasPendingCustomers: false,
    });
  }

  const teamCounts: ReclamationSummaryCounts = {
    ...aggregateRiskCounts(snapshots),
    memberCount: byOwner.size,
  };
  const adminIds = await listActiveAdminUserIds(db);
  const adminFinal = teamCounts.tomorrowCount > 0;

  for (const adminId of adminIds) {
    await upsertSummaryNotification(db, {
      userId: adminId,
      type: "reclamation.summary.admin",
      groupingKey: adminReclamationGroupingKey(),
      summaryScope: "admin_team",
      titleKey: adminFinal
        ? "notificationTypes.reclamation_summary_admin_urgent"
        : "notificationTypes.reclamation_summary_admin",
      messageKey: adminFinal
        ? "notificationMessages.reclamationSummaryAdminUrgent"
        : "notificationMessages.reclamationSummaryAdmin",
      messageParams: buildAdminSummaryMessageParams(teamCounts),
      counts: teamCounts,
      riskEpisodeKeys: snapshots.map((snapshot) => snapshot.riskEpisodeKey),
      nowIso,
      hasPendingCustomers: teamCounts.totalCount > 0,
    });
  }
}

export async function completeReclamationActionItemsForFollowUp(
  db: Database,
  input: {
    customerId: string;
    ownerId: string;
    cycleStartedAt: string;
    followUpId: string;
    now?: Date;
  },
): Promise<void> {
  const nowIso = (input.now ?? new Date()).toISOString();
  await db
    .update(schema.reclamationActionItems)
    .set({
      actionState: "completed",
      completedAt: nowIso,
      completedFollowUpId: input.followUpId,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(schema.reclamationActionItems.customerId, input.customerId),
        eq(schema.reclamationActionItems.cycleStartedAt, input.cycleStartedAt),
        eq(schema.reclamationActionItems.userId, input.ownerId),
        eq(schema.reclamationActionItems.actionState, "pending"),
      ),
    );

  await syncReclamationWorkItems(db, input.now ?? new Date());
}

export async function expireReclamationActionItems(
  db: Database,
  input: {
    customerId: string;
    userId?: string;
    cycleStartedAt?: string;
    reason: ReclamationExpireReason;
    now?: Date;
  },
): Promise<void> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const conditions = [
    eq(schema.reclamationActionItems.customerId, input.customerId),
    eq(schema.reclamationActionItems.actionState, "pending"),
  ];
  if (input.userId) {
    conditions.push(eq(schema.reclamationActionItems.userId, input.userId));
  }
  if (input.cycleStartedAt) {
    conditions.push(
      eq(schema.reclamationActionItems.cycleStartedAt, input.cycleStartedAt),
    );
  }

  await db
    .update(schema.reclamationActionItems)
    .set({
      actionState: "expired",
      expiredAt: nowIso,
      expireReason: input.reason,
      updatedAt: nowIso,
    })
    .where(and(...conditions));

  await syncReclamationWorkItems(db, input.now ?? new Date());
}

export async function listPendingReclamationCustomerIdsForUser(
  db: Database,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ customerId: schema.reclamationActionItems.customerId })
    .from(schema.reclamationActionItems)
    .where(
      and(
        eq(schema.reclamationActionItems.userId, userId),
        eq(schema.reclamationActionItems.actionState, "pending"),
      ),
    );
  return [...new Set(rows.map((row) => row.customerId))];
}

export async function listTeamPendingReclamationRows(
  db: Database,
): Promise<
  Array<{
    customerId: string;
    ownerId: string;
    idleDays: number;
    riskBand: string;
    cycleStartedAt: string;
  }>
> {
  return db
    .select({
      customerId: schema.reclamationActionItems.customerId,
      ownerId: schema.reclamationActionItems.userId,
      idleDays: schema.reclamationActionItems.idleDays,
      riskBand: schema.reclamationActionItems.riskBand,
      cycleStartedAt: schema.reclamationActionItems.cycleStartedAt,
    })
    .from(schema.reclamationActionItems)
    .where(eq(schema.reclamationActionItems.actionState, "pending"));
}

export async function resolveReclamationRiskCustomerIds(
  db: Database,
  user: User,
  risk?: string,
): Promise<string[] | undefined> {
  if (risk === "mine") {
    return listPendingReclamationCustomerIdsForUser(db, user.id);
  }
  if (risk === "team" && user.role === "admin") {
    const rows = await listTeamPendingReclamationRows(db);
    return [...new Set(rows.map((row) => row.customerId))];
  }
  return undefined;
}

export { buildRiskEpisodeKey, getAutomaticReclaimRuleState, getReclaimRuleVersion };
