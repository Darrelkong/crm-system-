import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

/** Matches migration 0025 backfill action semantics (system actor = null userId). */
export const MISSING_PRIMARY_BACKFILL_AUDIT_ACTION =
  "customer.assignee.primary_backfilled" as const;

export const MISSING_PRIMARY_BACKFILL_SOURCE =
  "missing_primary_backfill" as const;

/**
 * Deterministic primary assignee id — identical to migration 0025:
 * `'ca_' || customer.id || '_' || customer.owner_id`
 */
export function deterministicPrimaryAssigneeId(
  customerId: string,
  ownerId: string,
): string {
  return `ca_${customerId}_${ownerId}`;
}

export type MissingPrimaryTarget = {
  customerId: string;
  customerCode: string | null;
  ownerId: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MissingPrimaryAnomalyStats = {
  activeMultiPrimary: number;
  activePrimaryNeOwner: number;
  activeOnlyCollaboratorNoPrimary: number;
  /** Candidates that already have any assignee row for the owner (unique conflict risk). */
  ownerAlreadyAssigneeOnTarget: number;
  /** Candidates whose deterministic id is already taken by a conflicting row. */
  deterministicIdConflict: number;
};

export type MissingPrimaryDryRunResult = {
  mode: "dry-run";
  targetCount: number;
  /** Sorted by customerId — id + code + owner only (no PII). */
  targets: Array<{
    customerId: string;
    customerCode: string | null;
    ownerId: string;
  }>;
  snapshotHash: string;
  anomalies: MissingPrimaryAnomalyStats;
  safeToApply: boolean;
  blockers: string[];
  rowsWritten: 0;
};

export type MissingPrimaryBackfillManifestEntry = {
  assigneeId: string;
  customerId: string;
  ownerId: string;
};

export type MissingPrimaryApplyResult = {
  mode: "apply";
  backfillRunId: string;
  attemptedCount: number;
  insertedCount: number;
  skippedAlreadyCompliant: number;
  manifest: MissingPrimaryBackfillManifestEntry[];
  snapshotHash: string;
  rowsWritten: number;
};

export type MissingPrimaryApplyOptions = {
  expectedCount: number;
  expectedSnapshot: string;
  /** Optional stable run id; defaults to a new UUID. */
  backfillRunId?: string;
};

export class MissingPrimaryBackfillError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "SNAPSHOT_MISMATCH"
      | "COUNT_MISMATCH"
      | "INVARIANT_BLOCKER"
      | "TARGET_CONFLICT"
      | "INVALID_OPTIONS",
  ) {
    super(message);
    this.name = "MissingPrimaryBackfillError";
  }
}

/** Snapshot payload: sorted customerId lines of `customerId\tcustomerCode\townerId`. */
export function buildSnapshotPayload(
  targets: Array<{
    customerId: string;
    customerCode: string | null;
    ownerId: string;
  }>,
): string {
  const sorted = [...targets].sort((a, b) =>
    a.customerId.localeCompare(b.customerId),
  );
  return sorted
    .map(
      (t) =>
        `${t.customerId}\t${t.customerCode ?? ""}\t${t.ownerId}`,
    )
    .join("\n");
}

export function computeSnapshotHash(
  targets: Array<{
    customerId: string;
    customerCode: string | null;
    ownerId: string;
  }>,
): string {
  const payload = buildSnapshotPayload(targets);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Exact candidate query shared by dry-run and apply.
 * Does not return PII fields (name/phone/email/etc.).
 */
export async function queryMissingPrimaryTargets(
  db: Database,
): Promise<MissingPrimaryTarget[]> {
  const rows = await db
    .select({
      customerId: schema.customers.id,
      customerCode: schema.customers.customerCode,
      ownerId: schema.customers.ownerId,
      createdBy: schema.customers.createdBy,
      createdAt: schema.customers.createdAt,
      updatedAt: schema.customers.updatedAt,
      ownerIsActive: schema.users.isActive,
      ownerDeletedAt: schema.users.deletedAt,
    })
    .from(schema.customers)
    .innerJoin(
      schema.users,
      eq(schema.customers.ownerId, schema.users.id),
    )
    .where(eq(schema.customers.status, "active"))
    .orderBy(schema.customers.id);

  const primaryRows = await db
    .select({
      customerId: schema.customerAssignees.customerId,
    })
    .from(schema.customerAssignees)
    .where(eq(schema.customerAssignees.role, "primary"));
  const hasPrimary = new Set(primaryRows.map((r) => r.customerId));

  const targets: MissingPrimaryTarget[] = [];
  for (const row of rows) {
    if (!row.ownerId) {
      continue;
    }
    if (row.ownerIsActive !== 1) {
      continue;
    }
    if (row.ownerDeletedAt) {
      continue;
    }
    if (hasPrimary.has(row.customerId)) {
      continue;
    }
    targets.push({
      customerId: row.customerId,
      customerCode: row.customerCode ?? null,
      ownerId: row.ownerId,
      createdBy: row.createdBy ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  return targets;
}

export async function queryMissingPrimaryAnomalies(
  db: Database,
): Promise<MissingPrimaryAnomalyStats> {
  const activeCustomers = await db
    .select({
      id: schema.customers.id,
      ownerId: schema.customers.ownerId,
    })
    .from(schema.customers)
    .where(eq(schema.customers.status, "active"));

  const activeIds = activeCustomers.map((c) => c.id);
  if (activeIds.length === 0) {
    return {
      activeMultiPrimary: 0,
      activePrimaryNeOwner: 0,
      activeOnlyCollaboratorNoPrimary: 0,
      ownerAlreadyAssigneeOnTarget: 0,
      deterministicIdConflict: 0,
    };
  }

  const assigneeRows = await db
    .select({
      customerId: schema.customerAssignees.customerId,
      userId: schema.customerAssignees.userId,
      role: schema.customerAssignees.role,
    })
    .from(schema.customerAssignees);

  const activeIdSet = new Set(activeIds);
  const ownerByCustomer = new Map(
    activeCustomers.map((c) => [c.id, c.ownerId] as const),
  );

  const primaryCountByCustomer = new Map<string, number>();
  const hasCollaborator = new Set<string>();
  let activePrimaryNeOwner = 0;

  for (const row of assigneeRows) {
    if (!activeIdSet.has(row.customerId)) {
      continue;
    }
    if (row.role === "collaborator") {
      hasCollaborator.add(row.customerId);
    }
    if (row.role === "primary") {
      primaryCountByCustomer.set(
        row.customerId,
        (primaryCountByCustomer.get(row.customerId) ?? 0) + 1,
      );
      const ownerId = ownerByCustomer.get(row.customerId) ?? null;
      if (ownerId == null || row.userId !== ownerId) {
        activePrimaryNeOwner += 1;
      }
    }
  }

  let activeMultiPrimary = 0;
  let activeOnlyCollaboratorNoPrimary = 0;
  for (const customerId of activeIds) {
    const primaryCount = primaryCountByCustomer.get(customerId) ?? 0;
    if (primaryCount > 1) {
      activeMultiPrimary += 1;
    }
    if (primaryCount === 0 && hasCollaborator.has(customerId)) {
      activeOnlyCollaboratorNoPrimary += 1;
    }
  }

  return {
    activeMultiPrimary,
    activePrimaryNeOwner,
    activeOnlyCollaboratorNoPrimary,
    ownerAlreadyAssigneeOnTarget: 0,
    deterministicIdConflict: 0,
  };
}

async function assessTargetConflicts(
  db: Database,
  targets: MissingPrimaryTarget[],
): Promise<{
  ownerAlreadyAssigneeOnTarget: number;
  deterministicIdConflict: number;
  blockers: string[];
}> {
  const blockers: string[] = [];
  let ownerAlreadyAssigneeOnTarget = 0;
  let deterministicIdConflict = 0;

  for (const target of targets) {
    const assigneeId = deterministicPrimaryAssigneeId(
      target.customerId,
      target.ownerId,
    );

    const ownerRows = await db
      .select({
        id: schema.customerAssignees.id,
        role: schema.customerAssignees.role,
        userId: schema.customerAssignees.userId,
      })
      .from(schema.customerAssignees)
      .where(
        and(
          eq(schema.customerAssignees.customerId, target.customerId),
          eq(schema.customerAssignees.userId, target.ownerId),
        ),
      )
      .limit(1);

    if (ownerRows.length > 0) {
      ownerAlreadyAssigneeOnTarget += 1;
      blockers.push(
        `owner already has assignee row on ${target.customerId} (role=${ownerRows[0]?.role})`,
      );
    }

    const idRows = await db
      .select({
        id: schema.customerAssignees.id,
        customerId: schema.customerAssignees.customerId,
        userId: schema.customerAssignees.userId,
        role: schema.customerAssignees.role,
      })
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, assigneeId))
      .limit(1);

    if (idRows.length > 0) {
      const existing = idRows[0]!;
      const matches =
        existing.customerId === target.customerId &&
        existing.userId === target.ownerId &&
        existing.role === "primary";
      if (!matches) {
        deterministicIdConflict += 1;
        blockers.push(
          `deterministic id conflict for ${assigneeId} on ${target.customerId}`,
        );
      }
    }
  }

  return { ownerAlreadyAssigneeOnTarget, deterministicIdConflict, blockers };
}

function evaluateSafeToApply(
  anomalies: MissingPrimaryAnomalyStats,
  conflictBlockers: string[],
): { safeToApply: boolean; blockers: string[] } {
  const blockers: string[] = [...conflictBlockers];
  if (anomalies.activeMultiPrimary > 0) {
    blockers.push(`active multi-primary count=${anomalies.activeMultiPrimary}`);
  }
  if (anomalies.activePrimaryNeOwner > 0) {
    blockers.push(
      `active primary≠owner count=${anomalies.activePrimaryNeOwner}`,
    );
  }
  if (anomalies.ownerAlreadyAssigneeOnTarget > 0) {
    blockers.push(
      `owner already assignee on target count=${anomalies.ownerAlreadyAssigneeOnTarget}`,
    );
  }
  if (anomalies.deterministicIdConflict > 0) {
    blockers.push(
      `deterministic id conflict count=${anomalies.deterministicIdConflict}`,
    );
  }
  return { safeToApply: blockers.length === 0, blockers };
}

export async function runMissingPrimaryDryRun(
  db: Database,
): Promise<MissingPrimaryDryRunResult> {
  const fullTargets = await queryMissingPrimaryTargets(db);
  const anomalies = await queryMissingPrimaryAnomalies(db);
  const conflicts = await assessTargetConflicts(db, fullTargets);

  anomalies.ownerAlreadyAssigneeOnTarget =
    conflicts.ownerAlreadyAssigneeOnTarget;
  anomalies.deterministicIdConflict = conflicts.deterministicIdConflict;

  const { safeToApply, blockers } = evaluateSafeToApply(
    anomalies,
    conflicts.blockers,
  );

  const targets = fullTargets.map((t) => ({
    customerId: t.customerId,
    customerCode: t.customerCode,
    ownerId: t.ownerId,
  }));

  return {
    mode: "dry-run",
    targetCount: targets.length,
    targets,
    snapshotHash: computeSnapshotHash(targets),
    anomalies,
    safeToApply,
    blockers,
    rowsWritten: 0,
  };
}

/**
 * Inserts missing primary rows using migration 0025 field semantics.
 * Requires expectedCount + expectedSnapshot to match a fresh re-query.
 * System actor: audit userId = null (schema allows null).
 */
export async function runMissingPrimaryApply(
  db: Database,
  options: MissingPrimaryApplyOptions,
): Promise<MissingPrimaryApplyResult> {
  if (
    !Number.isInteger(options.expectedCount) ||
    options.expectedCount < 0
  ) {
    throw new MissingPrimaryBackfillError(
      "expectedCount must be a non-negative integer",
      "INVALID_OPTIONS",
    );
  }
  if (
    typeof options.expectedSnapshot !== "string" ||
    options.expectedSnapshot.length === 0
  ) {
    throw new MissingPrimaryBackfillError(
      "expectedSnapshot is required",
      "INVALID_OPTIONS",
    );
  }

  const fullTargets = await queryMissingPrimaryTargets(db);
  const snapshotTargets = fullTargets.map((t) => ({
    customerId: t.customerId,
    customerCode: t.customerCode,
    ownerId: t.ownerId,
  }));
  const snapshotHash = computeSnapshotHash(snapshotTargets);

  if (fullTargets.length !== options.expectedCount) {
    throw new MissingPrimaryBackfillError(
      `count mismatch: live=${fullTargets.length} expected=${options.expectedCount}`,
      "COUNT_MISMATCH",
    );
  }
  if (snapshotHash !== options.expectedSnapshot) {
    throw new MissingPrimaryBackfillError(
      `snapshot mismatch: live=${snapshotHash} expected=${options.expectedSnapshot}`,
      "SNAPSHOT_MISMATCH",
    );
  }

  const anomalies = await queryMissingPrimaryAnomalies(db);
  const conflicts = await assessTargetConflicts(db, fullTargets);
  anomalies.ownerAlreadyAssigneeOnTarget =
    conflicts.ownerAlreadyAssigneeOnTarget;
  anomalies.deterministicIdConflict = conflicts.deterministicIdConflict;
  const { safeToApply, blockers } = evaluateSafeToApply(
    anomalies,
    conflicts.blockers,
  );
  if (!safeToApply) {
    throw new MissingPrimaryBackfillError(
      `invariant blockers: ${blockers.join("; ")}`,
      "INVARIANT_BLOCKER",
    );
  }

  // Extra hard stops from the phase brief.
  for (const target of fullTargets) {
    const customerRows = await db
      .select({ status: schema.customers.status })
      .from(schema.customers)
      .where(eq(schema.customers.id, target.customerId))
      .limit(1);
    const status = customerRows[0]?.status;
    if (status === "public_pool") {
      throw new MissingPrimaryBackfillError(
        `public_pool candidate ${target.customerId}`,
        "INVARIANT_BLOCKER",
      );
    }
    if (status !== "active") {
      throw new MissingPrimaryBackfillError(
        `non-active candidate ${target.customerId} status=${status}`,
        "INVARIANT_BLOCKER",
      );
    }
  }

  const backfillRunId = options.backfillRunId ?? crypto.randomUUID();
  const toInsert: MissingPrimaryTarget[] = [];
  let skippedAlreadyCompliant = 0;

  for (const target of fullTargets) {
    const assigneeId = deterministicPrimaryAssigneeId(
      target.customerId,
      target.ownerId,
    );
    const existingPrimary = await db
      .select({ id: schema.customerAssignees.id })
      .from(schema.customerAssignees)
      .where(
        and(
          eq(schema.customerAssignees.customerId, target.customerId),
          eq(schema.customerAssignees.role, "primary"),
        ),
      )
      .limit(1);
    if (existingPrimary.length > 0) {
      skippedAlreadyCompliant += 1;
      continue;
    }

    const existingById = await db
      .select({ id: schema.customerAssignees.id })
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, assigneeId))
      .limit(1);
    if (existingById.length > 0) {
      // Idempotent path: deterministic row already present as matching primary.
      skippedAlreadyCompliant += 1;
      continue;
    }

    toInsert.push(target);
  }

  if (toInsert.length === 0) {
    return {
      mode: "apply",
      backfillRunId,
      attemptedCount: fullTargets.length,
      insertedCount: 0,
      skippedAlreadyCompliant,
      manifest: [],
      snapshotHash,
      rowsWritten: 0,
    };
  }

  const manifest: MissingPrimaryBackfillManifestEntry[] = toInsert.map(
    (target) => ({
      assigneeId: deterministicPrimaryAssigneeId(
        target.customerId,
        target.ownerId,
      ),
      customerId: target.customerId,
      ownerId: target.ownerId,
    }),
  );

  // D1 batch statement limit is 100. Pair insert + audit = 2 stmts/target.
  // Chunk by 40 targets (80 stmts) to stay safely under the limit.
  const CHUNK = 40;
  for (let offset = 0; offset < toInsert.length; offset += CHUNK) {
    const chunk = toInsert.slice(offset, offset + CHUNK);
    const statements: unknown[] = [];

    for (const target of chunk) {
      const assigneeId = deterministicPrimaryAssigneeId(
        target.customerId,
        target.ownerId,
      );
      // Migration 0025 semantics:
      // assigned_by = COALESCE(created_by, owner_id)
      // assigned_at / created_at = customer.created_at
      // updated_at = customer.updated_at
      statements.push(
        db.insert(schema.customerAssignees).values({
          id: assigneeId,
          customerId: target.customerId,
          userId: target.ownerId,
          role: "primary",
          assignedBy: target.createdBy ?? target.ownerId,
          assignedAt: target.createdAt,
          createdAt: target.createdAt,
          updatedAt: target.updatedAt,
        }),
      );
      statements.push(
        db.insert(schema.auditLogs).values({
          id: crypto.randomUUID(),
          userId: null,
          action: MISSING_PRIMARY_BACKFILL_AUDIT_ACTION,
          entityType: "customer",
          entityId: target.customerId,
          ipAddress: null,
          userAgent: null,
          metadata: JSON.stringify({
            customerId: target.customerId,
            ownerId: target.ownerId,
            assigneeId,
            backfillRunId,
            source: MISSING_PRIMARY_BACKFILL_SOURCE,
          }),
          createdAt: new Date().toISOString(),
        }),
      );
    }

    await db.batch(
      statements as unknown as Parameters<Database["batch"]>[0],
    );
  }

  return {
    mode: "apply",
    backfillRunId,
    attemptedCount: fullTargets.length,
    insertedCount: manifest.length,
    skippedAlreadyCompliant,
    manifest,
    snapshotHash,
    rowsWritten: manifest.length,
  };
}

/**
 * Deletes only primary rows listed in the manifest (exact assignee ids).
 * Re-checks each row is still primary for the recorded customer/owner before delete.
 */
export async function rollbackMissingPrimaryBackfill(
  db: Database,
  manifest: MissingPrimaryBackfillManifestEntry[],
): Promise<{ deletedCount: number; skippedCount: number }> {
  let deletedCount = 0;
  let skippedCount = 0;

  for (const entry of manifest) {
    const rows = await db
      .select({
        id: schema.customerAssignees.id,
        role: schema.customerAssignees.role,
        customerId: schema.customerAssignees.customerId,
        userId: schema.customerAssignees.userId,
      })
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, entry.assigneeId))
      .limit(1);

    const row = rows[0];
    if (
      !row ||
      row.role !== "primary" ||
      row.customerId !== entry.customerId ||
      row.userId !== entry.ownerId
    ) {
      skippedCount += 1;
      continue;
    }

    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, entry.assigneeId));
    deletedCount += 1;
  }

  return { deletedCount, skippedCount };
}
