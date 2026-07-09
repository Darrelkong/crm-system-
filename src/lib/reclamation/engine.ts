import { and, eq, gte, inArray, isNotNull, notInArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { createNotification } from "@/lib/notifications/service";
import type { Customer } from "../../../drizzle/schema/customers";
import {
  AUTO_RECLAIM_POOL_REASON_PREFIX,
  RECLAIM_WARNING_LOG_TYPE,
  RECLAMATION_AUDIT_ACTIONS,
  RECLAMATION_EXCLUDED_SALES_STAGES,
} from "./constants";
import {
  getDaysWithoutValidFollowUp,
  getReclamationAnchorAt,
  getWarningDateKey,
} from "./days";
import {
  getEffectiveSettings,
  type EffectiveSettings,
} from "@/lib/settings/effective";
import { getCollaborativeCustomerIds } from "./collaborative";
import { countCustomerAssignees } from "@/lib/public-pool/assignee-sync";

export type ReclamationRunResult = {
  /** Pre-reclaim warnings sent this run (single-warning model, E-4b). */
  warningsCount: number;
  reclaimedCount: number;
  skippedCount: number;
  affectedCustomerIds: string[];
  /** Customers skipped because they have ≥1 collaborator (C-2). */
  skippedCollaborativeCount: number;
  /** @deprecated Kept for backward-compatible callers/tests; equals warningsCount. */
  warningsDay6Count: number;
  /** @deprecated Two-stage warning removed in E-4b; always 0. */
  warningsDay7Count: number;
};

type ReclamationAuditMetadata = {
  customerId: string;
  previousOwnerId: string | null;
  daysWithoutValidFollowUp: number;
  lastValidFollowUpAt: string | null;
  executedBy: "system";
};

function buildAuditMetadata(
  customer: Customer,
  days: number,
): ReclamationAuditMetadata {
  return {
    customerId: customer.id,
    previousOwnerId: customer.ownerId,
    daysWithoutValidFollowUp: days,
    lastValidFollowUpAt: customer.lastValidFollowUpAt,
    executedBy: "system",
  };
}

async function cancelOwnerOpenTasks(
  db: Database,
  customerId: string,
  previousOwnerId: string,
  now: string,
  customerName: string,
): Promise<number> {
  const openTasks = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.customerId, customerId),
        eq(schema.tasks.assignedTo, previousOwnerId),
        eq(schema.tasks.status, "open"),
        inArray(schema.tasks.type, ["follow_up", "first_contact"]),
      ),
    );

  for (const task of openTasks) {
    await db
      .update(schema.tasks)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(schema.tasks.id, task.id));

    await writeAuditLog(
      {
        userId: null,
        action: RECLAMATION_AUDIT_ACTIONS.taskCancelled,
        entityType: "task",
        entityId: task.id,
        metadata: {
          customerId,
          customerName,
          previousOwnerId,
          taskType: task.type,
          executedBy: "system",
        },
      },
      db,
    );
  }

  return openTasks.length;
}

/**
 * Per-cycle dedup for the single pre-reclaim warning (E-4b).
 *
 * A "cycle" starts at the customer's reclamation anchor
 * (lastValidFollowUpAt ?? createdAt). We only send one warning per cycle:
 * if any warning log exists with created_at >= anchorIso we skip. A new
 * valid follow-up advances the anchor and starts a fresh cycle.
 *
 * Includes legacy warning_type values so customers already warned under
 * the old two-stage model are not double-notified.
 */
async function hasWarningInCurrentCycle(
  db: Database,
  customerId: string,
  anchorIso: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.reclamationWarningLogs.id })
    .from(schema.reclamationWarningLogs)
    .where(
      and(
        eq(schema.reclamationWarningLogs.customerId, customerId),
        gte(schema.reclamationWarningLogs.createdAt, anchorIso),
        inArray(schema.reclamationWarningLogs.warningType, ["day_6", "day_7"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function sendReclaimWarning(
  db: Database,
  customer: Customer,
  days: number,
  warningDate: string,
  settings: EffectiveSettings,
): Promise<boolean> {
  if (!customer.ownerId) {
    return false;
  }

  const anchorIso = getReclamationAnchorAt(customer);
  if (await hasWarningInCurrentCycle(db, customer.id, anchorIso)) {
    return false;
  }

  // DB UNIQUE(customer_id, warning_type, warning_date) also guards against
  // same-day duplicates if two cron runs race.
  try {
    await db.insert(schema.reclamationWarningLogs).values({
      id: crypto.randomUUID(),
      customerId: customer.id,
      warningType: RECLAIM_WARNING_LOG_TYPE,
      warningDate,
      ownerId: customer.ownerId,
      createdAt: new Date().toISOString(),
    });
  } catch {
    return false;
  }

  const metadata = buildAuditMetadata(customer, days);

  await createNotification(db, {
    userId: customer.ownerId,
    type: "auto_reclaim_warning_day_6",
    titleKey: "notificationTypes.auto_reclaim_warning_day_6",
    messageKey: "notificationMessages.autoReclaimWarning",
    messageParams: {
      customerName: customer.customerName,
      days: String(days),
      reclaimDays: String(settings.automaticReclaimDays),
      daysBefore: String(settings.reclaimWarningDaysBefore),
    },
    relatedEntityType: "customer",
    relatedEntityId: customer.id,
  });

  await writeAuditLog(
    {
      userId: null,
      action: RECLAMATION_AUDIT_ACTIONS.warning,
      entityType: "customer",
      entityId: customer.id,
      metadata,
    },
    db,
  );

  return true;
}

async function autoReclaimCustomer(
  db: Database,
  customer: Customer,
  days: number,
  now: string,
  settings: EffectiveSettings,
): Promise<boolean> {
  const previousOwnerId = customer.ownerId;
  if (!previousOwnerId) {
    return false;
  }

  try {
    const clearedAssigneeCount = await countCustomerAssignees(db, customer.id);

    await db.batch([
      db
        .update(schema.customers)
        .set({
          ownerId: null,
          status: "public_pool",
          poolEnteredAt: now,
          poolReason: `${AUTO_RECLAIM_POOL_REASON_PREFIX}${settings.automaticReclaimDays} 天无有效跟进`,
          releasedBy: null,
          releaserUserId: null,
          previousOwnerId,
          updatedBy: null,
          updatedAt: now,
        })
        .where(eq(schema.customers.id, customer.id)),
      db
        .delete(schema.customerAssignees)
        .where(eq(schema.customerAssignees.customerId, customer.id)),
    ] as unknown as Parameters<Database["batch"]>[0]);

    const cancelledTaskCount = await cancelOwnerOpenTasks(
      db,
      customer.id,
      previousOwnerId,
      now,
      customer.customerName,
    );

    const metadata = {
      ...buildAuditMetadata(customer, days),
      cancelledTaskCount,
      reclamationAnchorAt: getReclamationAnchorAt(customer),
      clearedAssigneeCount,
    };

    await writeAuditLog(
      {
        userId: null,
        action: RECLAMATION_AUDIT_ACTIONS.reclaimed,
        entityType: "customer",
        entityId: customer.id,
        metadata,
      },
      db,
    );

    await createNotification(db, {
      userId: previousOwnerId,
      type: "customer_auto_reclaimed",
      titleKey: "notificationTypes.customer_auto_reclaimed",
      messageKey: "notificationMessages.customerAutoReclaimed",
      messageParams: {
        customerName: customer.customerName,
        days: String(settings.automaticReclaimDays),
      },
      relatedEntityType: "customer",
      relatedEntityId: customer.id,
    });

    return true;
  } catch (error) {
    await writeAuditLog(
      {
        userId: null,
        action: RECLAMATION_AUDIT_ACTIONS.failed,
        entityType: "customer",
        entityId: customer.id,
        metadata: {
          ...buildAuditMetadata(customer, days),
          error: error instanceof Error ? error.message : String(error),
        },
      },
      db,
    );
    return false;
  }
}

/**
 * Evaluates active owned customers for the configured pre-reclaim warning
 * and auto-reclaim thresholds (single-warning model, E-4b).
 *
 *   reclaimDays      = automaticReclaimDays
 *   warningThreshold = reclaimDays - reclaimWarningDaysBefore
 *
 * Only status=active with owner_id set participate. Excludes
 * public_pool / inactive / archived, excluded sales stages
 * (closed_won, converted, on_hold), and pinned customers (is_pinned = 1).
 *
 * Sends at most one pre-reclaim warning per cycle (anchor = last valid
 * follow-up or createdAt). If the day-N cron run is missed, the next run
 * in the warning band still issues exactly one warning.
 */
export async function runReclamationCheck(
  db: Database,
  now: Date = new Date(),
): Promise<ReclamationRunResult> {
  const settings = await getEffectiveSettings(db);
  const warningDate = getWarningDateKey(now);
  const isoNow = now.toISOString();

  const reclaimDays = settings.automaticReclaimDays;
  const warningThreshold = settings.reclaimWarningThresholdDays;

  const eligibleCustomers = await db
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

  // C-2: identify collaborative customers (≥1 collaborator in customer_assignees)
  // so we can skip them from ordinary auto-reclaim. They will be handled by the
  // collaborative-dissolution rules introduced in PHASE-C-3.
  const collaborativeCustomerIds = await getCollaborativeCustomerIds(
    db,
    eligibleCustomers.map((c) => c.id),
  );

  const result: ReclamationRunResult = {
    warningsCount: 0,
    warningsDay6Count: 0,
    warningsDay7Count: 0,
    reclaimedCount: 0,
    skippedCount: 0,
    skippedCollaborativeCount: 0,
    affectedCustomerIds: [],
  };

  for (const customer of eligibleCustomers) {
    // C-2: collaborative customers are exempt from ordinary auto-reclaim and
    // pre-reclaim warnings. Skip without touching ownerId/status/assignees.
    if (collaborativeCustomerIds.has(customer.id)) {
      result.skippedCount += 1;
      result.skippedCollaborativeCount += 1;
      continue;
    }

    const days = getDaysWithoutValidFollowUp(customer, now);

    if (days >= reclaimDays) {
      const reclaimed = await autoReclaimCustomer(
        db,
        customer,
        days,
        isoNow,
        settings,
      );
      if (reclaimed) {
        result.reclaimedCount += 1;
        result.affectedCustomerIds.push(customer.id);
      } else {
        result.skippedCount += 1;
      }
      continue;
    }

    if (days >= warningThreshold) {
      const warned = await sendReclaimWarning(
        db,
        customer,
        days,
        warningDate,
        settings,
      );
      if (warned) {
        result.warningsCount += 1;
        result.warningsDay6Count += 1;
        result.affectedCustomerIds.push(customer.id);
      } else {
        result.skippedCount += 1;
      }
      continue;
    }

    result.skippedCount += 1;
  }

  return result;
}
