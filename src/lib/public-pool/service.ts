import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getEffectiveSettings } from "@/lib/settings/effective";
import {
  countCustomerAssignees,
  replaceCustomerPrimaryAssignee,
} from "@/lib/public-pool/assignee-sync";
import {
  CLAIM_QUOTA_DAYS,
  SELF_RELEASE_CLAIM_BLOCK_DAYS,
} from "@/lib/public-pool/constants";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export async function createFirstContactTask(
  customer: Customer,
  assigneeId: string,
  createdBy: string,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<string> {
  const db = getDb();
  const settings = await getEffectiveSettings(db);
  const now = new Date();
  const dueAt = new Date(
    now.getTime() + settings.firstContactSlaHours * 60 * 60 * 1000,
  ).toISOString();
  const taskId = crypto.randomUUID();
  const isoNow = now.toISOString();

  await db.insert(schema.tasks).values({
    id: taskId,
    customerId: customer.id,
    assignedTo: assigneeId,
    createdBy,
    title: `首次联系客户：${customer.customerName}`,
    type: "first_contact",
    status: "open",
    dueAt,
    createdAt: isoNow,
    updatedAt: isoNow,
  });

  await writeAuditLog({
    userId: createdBy,
    action: "task.created.first_contact",
    entityType: "task",
    entityId: taskId,
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
    metadata: { customerId: customer.id, dueAt },
  });

  return taskId;
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
      "db" in auditOrOptions)
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
    await database
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
          eq(schema.customers.ownerId, user.id),
          eq(schema.customers.status, "active"),
        ),
      );
    throw error;
  }

  const updated = { ...customer, customerName: customer.customerName };
  const taskId = await createFirstContactTask(updated, user.id, user.id, {
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  await writeAuditLog({
    userId: user.id,
    action: "customer.claimed_from_pool",
    entityType: "customer",
    entityId: customer.id,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    metadata: {
      customerName: customer.customerName,
      taskId,
      previousReleasedBy: customer.releasedBy ?? customer.releaserUserId,
      primaryAssigneeSynced: true,
      clearedAssigneeCount,
      ...options.successAuditMetadata,
    },
  });

  return { ok: true, taskId };
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
    },
  });
}
