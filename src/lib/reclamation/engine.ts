import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { createNotification } from "@/lib/notifications/service";
import type { Customer } from "../../../drizzle/schema/customers";
import type { ReclamationWarningType } from "../../../drizzle/schema/reclamation-warning-logs";
import {
  AUTO_RECLAIM_POOL_REASON,
  NOTIFICATION_TITLES,
  RECLAMATION_AUDIT_ACTIONS,
  RECLAMATION_RECLAIM_DAYS,
  RECLAMATION_WARNING_DAY_6,
  RECLAMATION_WARNING_DAY_7,
} from "./constants";
import {
  getDaysWithoutValidFollowUp,
  getReclamationAnchorAt,
  getWarningDateKey,
} from "./days";

export type ReclamationRunResult = {
  warningsDay6Count: number;
  warningsDay7Count: number;
  reclaimedCount: number;
  skippedCount: number;
  affectedCustomerIds: string[];
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

async function tryRecordWarning(
  db: Database,
  customer: Customer,
  warningType: ReclamationWarningType,
  warningDate: string,
): Promise<boolean> {
  if (!customer.ownerId) {
    return false;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await db.insert(schema.reclamationWarningLogs).values({
      id,
      customerId: customer.id,
      warningType,
      warningDate,
      ownerId: customer.ownerId,
      createdAt: now,
    });
    return true;
  } catch {
    return false;
  }
}

async function sendDay6Warning(
  db: Database,
  customer: Customer,
  days: number,
  warningDate: string,
): Promise<boolean> {
  if (!customer.ownerId) {
    return false;
  }

  const recorded = await tryRecordWarning(db, customer, "day_6", warningDate);
  if (!recorded) {
    return false;
  }

  const metadata = buildAuditMetadata(customer, days);

  await createNotification(db, {
    userId: customer.ownerId,
    type: "auto_reclaim_warning_day_6",
    title: NOTIFICATION_TITLES.warningDay6,
    message: `客户「${customer.customerName}」已经 6 天没有有效跟进，请尽快跟进。`,
    relatedEntityType: "customer",
    relatedEntityId: customer.id,
  });

  await writeAuditLog(
    {
      userId: null,
      action: RECLAMATION_AUDIT_ACTIONS.warningDay6,
      entityType: "customer",
      entityId: customer.id,
      metadata,
    },
    db,
  );

  return true;
}

async function sendDay7Warning(
  db: Database,
  customer: Customer,
  days: number,
  warningDate: string,
): Promise<boolean> {
  if (!customer.ownerId) {
    return false;
  }

  const recorded = await tryRecordWarning(db, customer, "day_7", warningDate);
  if (!recorded) {
    return false;
  }

  const metadata = buildAuditMetadata(customer, days);

  await createNotification(db, {
    userId: customer.ownerId,
    type: "auto_reclaim_warning_day_7",
    title: NOTIFICATION_TITLES.warningDay7,
    message: `客户「${customer.customerName}」已经 7 天没有有效跟进，若超过 8 天将自动回收到公共池。`,
    relatedEntityType: "customer",
    relatedEntityId: customer.id,
  });

  await writeAuditLog(
    {
      userId: null,
      action: RECLAMATION_AUDIT_ACTIONS.warningDay7,
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
): Promise<boolean> {
  const previousOwnerId = customer.ownerId;
  if (!previousOwnerId) {
    return false;
  }

  try {
    await db
      .update(schema.customers)
      .set({
        ownerId: null,
        status: "public_pool",
        poolEnteredAt: now,
        poolReason: AUTO_RECLAIM_POOL_REASON,
        releasedBy: null,
        releaserUserId: null,
        previousOwnerId,
        updatedBy: null,
        updatedAt: now,
      })
      .where(eq(schema.customers.id, customer.id));

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
      title: NOTIFICATION_TITLES.reclaimed,
      message: `客户「${customer.customerName}」已超过 8 天无有效跟进，已自动回收到公共池。`,
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
 * Evaluates active owned customers for day-6/day-7 warnings and 8-day auto-reclaim.
 * Only status=active with owner_id set participate. public_pool / inactive / archived are skipped.
 */
export async function runReclamationCheck(
  db: Database,
  now: Date = new Date(),
): Promise<ReclamationRunResult> {
  const warningDate = getWarningDateKey(now);
  const isoNow = now.toISOString();

  const eligibleCustomers = await db
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.status, "active"),
        isNotNull(schema.customers.ownerId),
      ),
    );

  const result: ReclamationRunResult = {
    warningsDay6Count: 0,
    warningsDay7Count: 0,
    reclaimedCount: 0,
    skippedCount: 0,
    affectedCustomerIds: [],
  };

  for (const customer of eligibleCustomers) {
    const days = getDaysWithoutValidFollowUp(customer, now);

    if (days >= RECLAMATION_RECLAIM_DAYS) {
      const reclaimed = await autoReclaimCustomer(db, customer, days, isoNow);
      if (reclaimed) {
        result.reclaimedCount += 1;
        result.affectedCustomerIds.push(customer.id);
      } else {
        result.skippedCount += 1;
      }
      continue;
    }

    if (days >= RECLAMATION_WARNING_DAY_7 && days < RECLAMATION_RECLAIM_DAYS) {
      const warned = await sendDay7Warning(db, customer, days, warningDate);
      if (warned) {
        result.warningsDay7Count += 1;
        result.affectedCustomerIds.push(customer.id);
      } else {
        result.skippedCount += 1;
      }
      continue;
    }

    if (days >= RECLAMATION_WARNING_DAY_6 && days < RECLAMATION_WARNING_DAY_7) {
      const warned = await sendDay6Warning(db, customer, days, warningDate);
      if (warned) {
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
