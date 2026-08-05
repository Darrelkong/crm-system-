import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  buildInsertAuditLogSelectStatement,
  writeAuditLog,
} from "@/lib/audit/audit-log";
import {
  buildCreateNotificationInsertSelectStatement,
  buildCreateNotificationStatement,
  resolveCreateNotificationContent,
} from "@/lib/notifications/service";
import { customerNameNotificationParams } from "@/lib/notifications/customer-name";
import type { Customer } from "../../../drizzle/schema/customers";
import { buildCancelOwnerOpenReclaimTasksStatement } from "@/lib/tasks/lifecycle";
import {
  AUTO_RECLAIM_POOL_REASON_PREFIX,
  RECLAMATION_AUDIT_ACTIONS,
  RECLAMATION_EXCLUDED_SALES_STAGES,
} from "./constants";
import {
  getDaysWithoutValidFollowUp,
  getReclamationAnchorAt,
  getWarningDateKey,
} from "./days";
import {
  getReclamationCycleStartedAt,
  isReclaimGraceActive,
} from "./cycle";
import {
  buildReclaimTimelineMessage,
  buildWarningTimelineMessage,
  getReclamationWarningMilestone,
  isFinalReclamationWarning,
  notificationTypeForMilestone,
  warningTypeForMilestone,
} from "./milestones";
import {
  getEffectiveSettings,
  type EffectiveSettings,
} from "@/lib/settings/effective";
import { getCollaborativeCustomerIds } from "./collaborative";
import { countCustomerAssignees } from "@/lib/public-pool/assignee-sync";
import { isReclamationWarningLogUniqueConflictError } from "./warning-log-unique";
import {
  buildAutoReclaimCustomerCasWhere,
  buildAutoReclaimCustomerExistsGuardSql,
  buildAutoReclaimSnapshotMatchSql,
  buildGuardedDeleteCustomerAssigneesStatement,
  buildSelectOwnerOpenReclaimTaskIds,
  extractChanges,
  toAutoReclaimCustomerSnapshot,
} from "./auto-reclaim-cas";

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

/**
 * Best-effort per-task audits after a successful reclaim batch.
 * Must not fail the reclaim, re-send notifications, or mutate the customer.
 */
async function writeCancelledTaskAuditsBestEffort(
  db: Database,
  input: {
    customerId: string;
    previousOwnerId: string;
    taskIds: string[];
  },
): Promise<void> {
  if (input.taskIds.length === 0) return;

  const cancelled = await db
    .select({
      id: schema.tasks.id,
      type: schema.tasks.type,
    })
    .from(schema.tasks)
    .where(
      and(
        inArray(schema.tasks.id, input.taskIds),
        eq(schema.tasks.customerId, input.customerId),
        eq(schema.tasks.assignedTo, input.previousOwnerId),
        eq(schema.tasks.status, "cancelled"),
        inArray(schema.tasks.type, ["follow_up", "first_contact"]),
      ),
    );

  for (const task of cancelled) {
    try {
      await writeAuditLog(
        {
          userId: null,
          action: RECLAMATION_AUDIT_ACTIONS.taskCancelled,
          entityType: "task",
          entityId: task.id,
          metadata: {
            customerId: input.customerId,
            previousOwnerId: input.previousOwnerId,
            taskType: task.type,
            executedBy: "system",
          },
        },
        db,
      );
    } catch (error) {
      console.error("[reclamation] task cancel audit failed", {
        customerId: input.customerId,
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Per-cycle milestone dedup: one warning per (cycle anchor, milestone).
 */
async function hasMilestoneWarningInCycle(
  db: Database,
  customerId: string,
  cycleStartedAt: string,
  milestone: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.reclamationWarningLogs.id })
    .from(schema.reclamationWarningLogs)
    .where(
      and(
        eq(schema.reclamationWarningLogs.customerId, customerId),
        eq(schema.reclamationWarningLogs.cycleStartedAt, cycleStartedAt),
        eq(schema.reclamationWarningLogs.warningMilestone, milestone),
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
  milestone: number,
): Promise<boolean> {
  if (!customer.ownerId) {
    return false;
  }

  const cycleStartedAt = getReclamationCycleStartedAt(customer);
  if (
    await hasMilestoneWarningInCycle(db, customer.id, cycleStartedAt, milestone)
  ) {
    return false;
  }

  const createdAt = new Date().toISOString();
  const warningLogId = crypto.randomUUID();
  const notificationId = crypto.randomUUID();
  const ownerId = customer.ownerId;
  const reclaimDays = settings.automaticReclaimDays;
  const isFinal = isFinalReclamationWarning(milestone, reclaimDays);
  const warningType = warningTypeForMilestone(milestone, reclaimDays);
  const notificationType = notificationTypeForMilestone(milestone, reclaimDays);
  const timelineMessage = buildWarningTimelineMessage({
    milestone,
    idleDays: days,
    reclaimDays,
    isFinal,
  });

  const warningLogStatement = db.insert(schema.reclamationWarningLogs).values({
    id: warningLogId,
    customerId: customer.id,
    warningType,
    warningDate,
    cycleStartedAt,
    warningMilestone: milestone,
    reclaimDaysSnapshot: reclaimDays,
    ownerId,
    createdAt,
  });
  const notificationStatement = buildCreateNotificationStatement(db, {
    id: notificationId,
    createdAt,
    userId: ownerId,
    type: notificationType,
    titleKey: `notificationTypes.${notificationType}`,
    messageKey: isFinal
      ? "notificationMessages.autoReclaimWarningFinal"
      : "notificationMessages.autoReclaimWarningMilestone",
    messageParams: {
      ...customerNameNotificationParams(customer),
      days: String(days),
      reclaimDays: String(reclaimDays),
      milestone: String(milestone),
      daysRemaining: String(reclaimDays - days),
      sequence: String(isFinal ? 0 : milestone / 7),
    },
    relatedEntityType: "customer",
    relatedEntityId: customer.id,
  });

  try {
    await db.batch(
      [warningLogStatement, notificationStatement] as unknown as Parameters<
        Database["batch"]
      >[0],
    );
  } catch (error) {
    if (isReclamationWarningLogUniqueConflictError(error)) {
      return false;
    }
    throw error;
  }

  const metadata = {
    ...buildAuditMetadata(customer, days),
    reclamationAnchorAt: cycleStartedAt,
    reclaimDaysSnapshot: reclaimDays,
    warningMilestone: milestone,
    warningSequence: isFinal ? 0 : milestone / 7,
    timelineMessage,
    isFinalWarning: isFinal,
  };

  await writeAuditLog(
    {
      userId: null,
      action: isFinal
        ? RECLAMATION_AUDIT_ACTIONS.warningDay7
        : RECLAMATION_AUDIT_ACTIONS.warning,
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
  const snapshot = toAutoReclaimCustomerSnapshot(customer);
  if (!snapshot) {
    return false;
  }

  const previousOwnerId = snapshot.ownerId;
  const customerExistsGuard = buildAutoReclaimCustomerExistsGuardSql(snapshot);
  const snapshotMatchSql = buildAutoReclaimSnapshotMatchSql(snapshot);

  const notificationId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const { title, message } = resolveCreateNotificationContent({
    userId: previousOwnerId,
    type: "customer_auto_reclaimed",
    titleKey: "notificationTypes.customer_auto_reclaimed",
    messageKey: "notificationMessages.customerAutoReclaimed",
    messageParams: {
      ...customerNameNotificationParams(customer),
      days: String(settings.automaticReclaimDays),
    },
    relatedEntityType: "customer",
    relatedEntityId: customer.id,
  });

  const clearedAssigneeCount = await countCustomerAssignees(db, customer.id);
  const openTasksToCancel = await buildSelectOwnerOpenReclaimTaskIds(
    db,
    customer.id,
    previousOwnerId,
  );
  const expectedCancelledTaskCount = openTasksToCancel.length;

  const reclaimMetadata = {
    ...buildAuditMetadata(customer, days),
    reclamationAnchorAt: getReclamationAnchorAt(customer),
    reclaimDaysSnapshot: settings.automaticReclaimDays,
    timelineMessage: buildReclaimTimelineMessage(settings.automaticReclaimDays),
    clearedAssigneeCount,
    cancelledTaskCount: expectedCancelledTaskCount,
  };
  const reclaimMetadataJson = JSON.stringify(reclaimMetadata);

  try {
    // Single guarded batch. Side effects use EXISTS(snapshot); Customer CAS last.
    // D1 cannot condition later statements on earlier affected rows, so CAS is last.
    const batchResults = (await db.batch([
      buildGuardedDeleteCustomerAssigneesStatement(db, snapshot),
      buildCancelOwnerOpenReclaimTasksStatement(db, {
        customerId: customer.id,
        previousOwnerId,
        now,
        customerSnapshotGuardSql: customerExistsGuard,
      }),
      buildCreateNotificationInsertSelectStatement(
        db,
        sql`
          SELECT
            ${notificationId} AS id,
            ${previousOwnerId} AS user_id,
            ${"customer_auto_reclaimed"} AS type,
            ${title} AS title,
            ${message} AS message,
            ${"customer"} AS related_entity_type,
            ${customer.id} AS related_entity_id,
            ${0} AS is_read,
            ${now} AS created_at
          FROM customers
          WHERE ${snapshotMatchSql}
        `,
      ),
      buildInsertAuditLogSelectStatement(
        db,
        sql`
          SELECT
            ${auditId} AS id,
            ${null} AS user_id,
            ${RECLAMATION_AUDIT_ACTIONS.reclaimed} AS action,
            ${"customer"} AS entity_type,
            ${customer.id} AS entity_id,
            ${null} AS ip_address,
            ${null} AS user_agent,
            ${reclaimMetadataJson} AS metadata,
            ${now} AS created_at
          FROM customers
          WHERE ${snapshotMatchSql}
        `,
      ),
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
        .where(buildAutoReclaimCustomerCasWhere(snapshot)),
    ] as unknown as Parameters<Database["batch"]>[0])) as unknown as unknown[];

    const customerChanges = extractChanges(batchResults[4]);
    const notificationChanges = extractChanges(batchResults[2]);
    const auditChanges = extractChanges(batchResults[3]);

    if (customerChanges === 0) {
      // Snapshot lost the race (or was never valid). Side effects should be 0.
      return false;
    }

    if (customerChanges !== 1) {
      throw new Error(
        `[reclamation] auto reclaim CAS returned unexpected changes=${String(customerChanges)}`,
      );
    }

    if (notificationChanges !== 1 || auditChanges !== 1) {
      throw new Error(
        `[reclamation] auto reclaim batch inconsistency notification=${String(notificationChanges)} audit=${String(auditChanges)}`,
      );
    }

    await writeCancelledTaskAuditsBestEffort(db, {
      customerId: customer.id,
      previousOwnerId,
      taskIds: openTasksToCancel.map((row) => row.id),
    });

    return true;
  } catch (error) {
    try {
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
    } catch (auditError) {
      console.error("[reclamation] failed audit write failed", {
        customerId: customer.id,
        error:
          auditError instanceof Error ? auditError.message : String(auditError),
      });
    }
    return false;
  }
}

/**
 * Evaluates active owned customers for milestone warnings and auto-reclaim.
 *
 *   - Every 7 idle days: periodic warning (7, 14, 21, …)
 *   - reclaimDays - 1: final urgent warning
 *   - reclaimDays: auto-reclaim (unless 24h rule-shortening grace active)
 */
export async function runReclamationCheck(
  db: Database,
  now: Date = new Date(),
): Promise<ReclamationRunResult> {
  const settings = await getEffectiveSettings(db);
  const warningDate = getWarningDateKey(now);
  const isoNow = now.toISOString();

  const reclaimDays = settings.automaticReclaimDays;

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
      if (isReclaimGraceActive(customer, now)) {
        result.skippedCount += 1;
        continue;
      }
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

    const milestone = getReclamationWarningMilestone(days, reclaimDays);
    if (milestone !== null) {
      const warned = await sendReclaimWarning(
        db,
        customer,
        days,
        warningDate,
        settings,
        milestone,
      );
      if (warned) {
        result.warningsCount += 1;
        if (isFinalReclamationWarning(milestone, reclaimDays)) {
          result.warningsDay7Count += 1;
        } else {
          result.warningsDay6Count += 1;
        }
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
