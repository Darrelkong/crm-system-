import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getEffectiveSettings } from "@/lib/settings/effective";
import {
  clearCustomerAssignees,
  countCustomerAssignees,
  replaceCustomerPrimaryAssignee,
} from "@/lib/public-pool/assignee-sync";
import {
  CLAIM_QUOTA_DAYS,
  SELF_RELEASE_CLAIM_BLOCK_DAYS,
} from "@/lib/public-pool/constants";
import {
  TASK_CANCEL_REASON,
  buildCancelOpenTasksForCustomerStatement,
  buildTaskCancelAuditFields,
} from "@/lib/tasks/lifecycle";
import {
  upsertFirstContactTaskForClaim,
  type UpsertFirstContactTaskForClaimResult,
} from "@/lib/tasks/first-contact";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

/**
 * Rolls back a claim that this actor still holds.
 * Clears assignees so the customer does not remain assigned after a failed claim.
 */
async function rollbackPoolClaimToPublicPool(
  db: Database,
  customer: Customer,
  actorId: string,
): Promise<void> {
  await db
    .update(schema.customers)
    .set({
      ownerId: null,
      status: "public_pool",
      claimedBy: null,
      claimedAt: null,
      poolLeftAt: null,
      updatedBy: customer.updatedBy,
      updatedAt: customer.updatedAt,
    })
    .where(
      and(
        eq(schema.customers.id, customer.id),
        eq(schema.customers.ownerId, actorId),
        eq(schema.customers.status, "active"),
      ),
    );

  await clearCustomerAssignees(db, customer.id);
}

async function writeFirstContactTaskAuditSafe(input: {
  actorId: string;
  customerId: string;
  result: UpsertFirstContactTaskForClaimResult;
  dueAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    if (input.result.createdNewTask) {
      await writeAuditLog({
        userId: input.actorId,
        action: "task.created.first_contact",
        entityType: "task",
        entityId: input.result.taskId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: { customerId: input.customerId, dueAt: input.dueAt },
      });
      return;
    }

    await writeAuditLog({
      userId: input.actorId,
      action: "task.updated",
      entityType: "task",
      entityId: input.result.taskId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: {
        customerId: input.customerId,
        reasonCode: "public_pool_claim",
        reusedExistingTask: true,
        deduplicatedExistingTasks: input.result.deduplicatedExistingTasks,
        previousAssigneeId: input.result.previousAssigneeId,
        nextAssigneeId: input.actorId,
        dueAtChanged: input.result.dueAtChanged,
        dueAt: input.dueAt,
      },
    });
  } catch {
    // Core claim already succeeded — do not reverse customer/task state for audit failures.
    console.error("[public-pool] first_contact task audit write failed", {
      customerId: input.customerId,
      taskId: input.result.taskId,
      createdNewTask: input.result.createdNewTask,
      reusedExistingTask: input.result.reusedExistingTask,
    });
  }
}

/** Params for atomic staff quota / cooldown / self-release SQL guards. */
export type StaffClaimGuardParams = {
  userId: string;
  quotaLimit: number;
  sevenDaysAgoIso: string;
  /** Last claim must be <= this ISO time (now - cooldownHours). */
  cooldownEligibleAtIso: string;
  /** Self-released poolEnteredAt must be <= this ISO time (now - 7d). */
  selfReleaseEligibleAtIso: string;
};

export async function buildStaffClaimGuardParams(
  userId: string,
  now: Date,
  db?: Database,
  options?: {
    /**
     * Internal/test seam only. Overrides cooldown hours used for SQL guards.
     * Never bind from HTTP request or system settings UI.
     */
    cooldownHoursOverride?: number;
  },
): Promise<StaffClaimGuardParams> {
  const database = db ?? getDb();
  const settings = await getEffectiveSettings(database);
  const cooldownHours =
    options?.cooldownHoursOverride ?? settings.publicPoolClaimCooldownHours;
  const cooldownMs = cooldownHours * 60 * 60 * 1000;

  return {
    userId,
    quotaLimit: settings.publicPoolClaimQuota7Days,
    sevenDaysAgoIso: new Date(
      now.getTime() - CLAIM_QUOTA_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
    cooldownEligibleAtIso: new Date(now.getTime() - cooldownMs).toISOString(),
    selfReleaseEligibleAtIso: new Date(
      now.getTime() - SELF_RELEASE_CLAIM_BLOCK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

/**
 * Same semantics as getStaffClaimStatus + getSelfReleaseClaimBlockState,
 * expressed as UPDATE WHERE fragments for same-staff concurrency safety.
 */
export function staffClaimGuardConditions(guards: StaffClaimGuardParams) {
  const quotaGuard = sql`(
    SELECT COUNT(*) FROM customers
    WHERE claimed_by = ${guards.userId}
      AND claimed_at IS NOT NULL
      AND claimed_at >= ${guards.sevenDaysAgoIso}
  ) < ${guards.quotaLimit}`;

  const cooldownGuard = sql`(
    NOT EXISTS (
      SELECT 1 FROM customers
      WHERE claimed_by = ${guards.userId}
        AND claimed_at IS NOT NULL
    )
    OR (
      SELECT claimed_at FROM customers
      WHERE claimed_by = ${guards.userId}
        AND claimed_at IS NOT NULL
      ORDER BY claimed_at DESC
      LIMIT 1
    ) <= ${guards.cooldownEligibleAtIso}
  )`;

  const selfReleaseGuard = sql`(
    COALESCE(released_by, releaser_user_id) IS NULL
    OR COALESCE(released_by, releaser_user_id) != ${guards.userId}
    OR pool_entered_at IS NULL
    OR pool_entered_at <= ${guards.selfReleaseEligibleAtIso}
  )`;

  return and(quotaGuard, cooldownGuard, selfReleaseGuard);
}

export type ClaimCustomerFromPoolResult =
  | { ok: true; taskId: string }
  | { ok: false; reason: "already_claimed" | "update_rejected" };

export type ClaimCustomerFromPoolOptions = {
  ipAddress?: string | null;
  userAgent?: string | null;
  now?: Date;
  db?: Database;
  /**
   * When set, Customer UPDATE also enforces staff quota / cooldown / self-release
   * in the same statement. Do not bind from client input.
   */
  staffGuards?: StaffClaimGuardParams;
  /** Extra success audit metadata (e.g. random claim method). */
  successAuditMetadata?: Record<string, unknown>;
  /**
   * Internal/test seam only. Overrides first-contact upsert used after claim.
   * Never bind from HTTP request.
   */
  upsertFirstContactTask?: typeof upsertFirstContactTaskForClaim;
};

export async function claimCustomerFromPool(
  customer: Customer,
  user: User,
  auditOrOptions?:
    | { ipAddress?: string | null; userAgent?: string | null }
    | ClaimCustomerFromPoolOptions,
): Promise<ClaimCustomerFromPoolResult> {
  const options: ClaimCustomerFromPoolOptions =
    auditOrOptions &&
    ("staffGuards" in auditOrOptions ||
      "successAuditMetadata" in auditOrOptions ||
      "now" in auditOrOptions ||
      "db" in auditOrOptions ||
      "upsertFirstContactTask" in auditOrOptions)
      ? auditOrOptions
      : {
          ipAddress: (
            auditOrOptions as
              | { ipAddress?: string | null; userAgent?: string | null }
              | undefined
          )?.ipAddress,
          userAgent: (
            auditOrOptions as
              | { ipAddress?: string | null; userAgent?: string | null }
              | undefined
          )?.userAgent,
        };

  const database = options.db ?? getDb();
  const claimedAtDate = options.now ?? new Date();
  const now = claimedAtDate.toISOString();
  const upsertTask =
    options.upsertFirstContactTask ?? upsertFirstContactTaskForClaim;

  const whereParts = [
    eq(schema.customers.id, customer.id),
    eq(schema.customers.status, "public_pool"),
    isNull(schema.customers.ownerId),
  ];
  if (options.staffGuards) {
    whereParts.push(staffClaimGuardConditions(options.staffGuards)!);
  }

  const updatedRows = await database
    .update(schema.customers)
    .set({
      ownerId: user.id,
      status: "active",
      claimedBy: user.id,
      claimedAt: now,
      poolLeftAt: now,
      updatedBy: user.id,
      updatedAt: now,
    })
    .where(and(...whereParts))
    .returning({ id: schema.customers.id });

  if (updatedRows.length === 0) {
    return {
      ok: false,
      reason: options.staffGuards ? "update_rejected" : "already_claimed",
    };
  }

  let clearedAssigneeCount = 0;
  try {
    const syncResult = await replaceCustomerPrimaryAssignee(database, {
      customerId: customer.id,
      userId: user.id,
      assignedBy: user.id,
      now,
    });
    clearedAssigneeCount = syncResult.clearedAssigneeCount;
  } catch (error) {
    try {
      await rollbackPoolClaimToPublicPool(database, customer, user.id);
    } catch {
      console.error("[public-pool] claim rollback failed after assignee sync failure", {
        customerId: customer.id,
        actorId: user.id,
      });
    }
    throw error;
  }

  const settings = await getEffectiveSettings(database);
  const dueAt = new Date(
    claimedAtDate.getTime() + settings.firstContactSlaHours * 60 * 60 * 1000,
  ).toISOString();

  let taskResult: UpsertFirstContactTaskForClaimResult;
  try {
    taskResult = await upsertTask({
      db: database,
      customerId: customer.id,
      actorId: user.id,
      customerName: customer.customerName,
      dueAt,
      now,
    });
  } catch (error) {
    try {
      await rollbackPoolClaimToPublicPool(database, customer, user.id);
    } catch {
      console.error(
        "[public-pool] claim rollback failed after first_contact write failure",
        {
          customerId: customer.id,
          actorId: user.id,
        },
      );
    }
    throw error;
  }

  await writeFirstContactTaskAuditSafe({
    actorId: user.id,
    customerId: customer.id,
    result: taskResult,
    dueAt,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  try {
    await writeAuditLog({
      userId: user.id,
      action: "customer.claimed_from_pool",
      entityType: "customer",
      entityId: customer.id,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      metadata: {
        customerName: customer.customerName,
        taskId: taskResult.taskId,
        previousReleasedBy: customer.releasedBy ?? customer.releaserUserId,
        primaryAssigneeSynced: true,
        clearedAssigneeCount,
        reusedExistingTask: taskResult.reusedExistingTask,
        deduplicatedExistingTasks: taskResult.deduplicatedExistingTasks,
        ...options.successAuditMetadata,
      },
    });
  } catch {
    // Core claim already succeeded — do not reverse customer/assignee/task.
    console.error("[public-pool] customer.claimed_from_pool audit write failed", {
      customerId: customer.id,
      taskId: taskResult.taskId,
      actorId: user.id,
    });
  }

  return { ok: true, taskId: taskResult.taskId };
}

export async function releaseCustomerToPool(
  customer: Customer,
  user: User,
  reason: string,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const previousOwnerId = customer.ownerId;
  const clearedAssigneeCount = await countCustomerAssignees(db, customer.id);

  await db.batch([
    db
      .update(schema.customers)
      .set({
        ownerId: null,
        status: "public_pool",
        poolEnteredAt: now,
        poolReason: reason.trim(),
        releasedBy: user.id,
        releaserUserId: user.id,
        previousOwnerId,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(schema.customers.id, customer.id)),
    db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, customer.id)),
    buildCancelOpenTasksForCustomerStatement(db, customer.id, now),
  ] as unknown as Parameters<typeof db.batch>[0]);

  await writeAuditLog({
    userId: user.id,
    action: "customer.released_to_pool",
    entityType: "customer",
    entityId: customer.id,
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
    metadata: {
      customerName: customer.customerName,
      poolReason: reason.trim(),
      previousOwnerId,
      clearedAssigneeCount,
      ...buildTaskCancelAuditFields(TASK_CANCEL_REASON.poolRelease),
    },
  });
}
