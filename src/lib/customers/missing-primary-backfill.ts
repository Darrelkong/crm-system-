import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

/** Matches migration 0025 backfill action semantics (system actor = null userId). */
export const MISSING_PRIMARY_BACKFILL_AUDIT_ACTION =
  "customer.assignee.primary_backfilled" as const;

export const MISSING_PRIMARY_BACKFILL_ROLLBACK_AUDIT_ACTION =
  "customer.assignee.primary_backfill_rolled_back" as const;

export const MISSING_PRIMARY_BACKFILL_SOURCE =
  "missing_primary_backfill" as const;

export const MISSING_PRIMARY_BACKFILL_MANIFEST_VERSION = 1 as const;

/** D1 batch statement limit is 100. Pair insert + assert-style audit = 2 stmts/target. */
export const MISSING_PRIMARY_BACKFILL_DEFAULT_CHUNK_SIZE = 40;

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
  auditLogId: string;
  chunkIndex: number;
};

export type MissingPrimaryBackfillManifestStatus =
  | "in_progress"
  | "completed"
  | "partial_failed";

export type MissingPrimaryBackfillManifest = {
  version: typeof MISSING_PRIMARY_BACKFILL_MANIFEST_VERSION;
  backfillRunId: string;
  snapshotHash: string;
  expectedCount: number;
  startedAt: string;
  updatedAt: string;
  status: MissingPrimaryBackfillManifestStatus;
  completedChunks: number;
  failedChunkIndex: number | null;
  errorCode: string | null;
  insertedRows: MissingPrimaryBackfillManifestEntry[];
};

export type MissingPrimaryApplyResult = {
  mode: "apply";
  backfillRunId: string;
  attemptedCount: number;
  insertedCount: number;
  skippedAlreadyCompliant: number;
  manifest: MissingPrimaryBackfillManifest;
  snapshotHash: string;
  rowsWritten: number;
};

export type MissingPrimaryApplyOptions = {
  expectedCount: number;
  expectedSnapshot: string;
  /** Optional stable run id; defaults to a new UUID. */
  backfillRunId?: string;
  /**
   * Required fail-closed persist hook. Called after manifest init, after each
   * successful chunk, and before throwing on partial failure.
   */
  onManifestUpdate: (
    manifest: MissingPrimaryBackfillManifest,
  ) => void | Promise<void>;
  /** Override chunk size (default 40). Intended for tests. */
  chunkSize?: number;
};

export type RollbackManifestEntry = {
  assigneeId: string;
  customerId: string;
  ownerId: string;
  auditLogId: string;
  chunkIndex: number;
};

export type RollbackSkipReason =
  | "assignee_missing"
  | "role_mismatch"
  | "customer_mismatch"
  | "user_mismatch"
  | "owner_transferred"
  | "replaced_primary";

export type RollbackSkip = {
  assigneeId: string;
  customerId: string;
  ownerId: string;
  reason: RollbackSkipReason;
};

export type MissingPrimaryRollbackManifest = {
  version: typeof MISSING_PRIMARY_BACKFILL_MANIFEST_VERSION;
  rollbackRunId: string;
  originalBackfillRunId: string;
  startedAt: string;
  updatedAt: string;
  status: MissingPrimaryBackfillManifestStatus;
  completedChunks: number;
  failedChunkIndex: number | null;
  errorCode: string | null;
  deletedRows: Array<{
    assigneeId: string;
    customerId: string;
    ownerId: string;
    rollbackAuditLogId: string;
    chunkIndex: number;
  }>;
  skipped: RollbackSkip[];
};

export type MissingPrimaryRollbackOptions = {
  originalBackfillRunId: string;
  rollbackRunId?: string;
  onManifestUpdate: (
    manifest: MissingPrimaryRollbackManifest,
  ) => void | Promise<void>;
  chunkSize?: number;
};

export type MissingPrimaryRollbackResult = {
  deletedCount: number;
  skippedCount: number;
  skipped: RollbackSkip[];
  manifest: MissingPrimaryRollbackManifest;
};

export class MissingPrimaryBackfillError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "SNAPSHOT_MISMATCH"
      | "COUNT_MISMATCH"
      | "INVARIANT_BLOCKER"
      | "TARGET_CONFLICT"
      | "INVALID_OPTIONS"
      | "TOCTOU_GUARD_FAILED"
      | "CHUNK_REVALIDATION_FAILED"
      | "PARTIAL_CHUNK_FAILED"
      | "MANIFEST_REQUIRED",
    public readonly manifest: MissingPrimaryBackfillManifest | null = null,
  ) {
    super(message);
    this.name = "MissingPrimaryBackfillError";
  }
}

export class MissingPrimaryRollbackError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_OPTIONS"
      | "PARTIAL_CHUNK_FAILED"
      | "MANIFEST_REQUIRED",
    public readonly manifest: MissingPrimaryRollbackManifest | null = null,
  ) {
    super(message);
    this.name = "MissingPrimaryRollbackError";
  }
}

/** Locale-independent ASCII / binary compare for stable snapshot ordering. */
export function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
    compareAscii(a.customerId, b.customerId),
  );
  return sorted
    .map(
      (t) => `${t.customerId}\t${t.customerCode ?? ""}\t${t.ownerId}`,
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

function nowIso(): string {
  return new Date().toISOString();
}

function extractChanges(result: unknown): number | null {
  if (
    result &&
    typeof result === "object" &&
    "meta" in result &&
    result.meta &&
    typeof result.meta === "object" &&
    "changes" in result.meta &&
    typeof (result.meta as { changes: unknown }).changes === "number"
  ) {
    return (result.meta as { changes: number }).changes;
  }
  return null;
}

function isConstraintNotNullError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("NOT NULL constraint failed") ||
    message.includes("SQLITE_CONSTRAINT_NOTNULL")
  );
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
 * Statement-level guarded primary insert.
 *
 * Always emits one candidate row via `FROM (SELECT 1)`. When guards fail,
 * `id` becomes NULL and SQLite aborts with NOT NULL — rolling back the whole
 * D1 batch (D1 forbids RAISE outside triggers; this is the fail-closed substitute).
 * Parameters are bound via drizzle `sql` — no string concatenation of ids.
 */
export function buildGuardedPrimaryInsertStatement(
  db: Database,
  target: MissingPrimaryTarget,
) {
  const assigneeId = deterministicPrimaryAssigneeId(
    target.customerId,
    target.ownerId,
  );

  return db.insert(schema.customerAssignees).select(
    sql`
      SELECT
        CASE
          WHEN
            ${schema.customers.id} IS NOT NULL
            AND ${schema.customers.status} = 'active'
            AND ${schema.customers.ownerId} = ${target.ownerId}
            AND ${schema.users.id} IS NOT NULL
            AND ${schema.users.isActive} = 1
            AND ${schema.users.deletedAt} IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM customer_assignees ca
              WHERE ca.customer_id = ${target.customerId}
                AND ca.role = 'primary'
            )
            AND NOT EXISTS (
              SELECT 1 FROM customer_assignees ca
              WHERE ca.id = ${assigneeId}
            )
            AND NOT EXISTS (
              SELECT 1 FROM customer_assignees ca
              WHERE ca.customer_id = ${target.customerId}
                AND ca.user_id = ${target.ownerId}
            )
          THEN ${assigneeId}
          ELSE NULL
        END AS id,
        COALESCE(${schema.customers.id}, ${target.customerId}) AS customer_id,
        COALESCE(${schema.customers.ownerId}, ${target.ownerId}) AS user_id,
        'primary' AS role,
        COALESCE(
          ${schema.customers.createdBy},
          ${schema.customers.ownerId},
          ${target.ownerId}
        ) AS assigned_by,
        COALESCE(${schema.customers.createdAt}, ${target.createdAt}) AS assigned_at,
        COALESCE(${schema.customers.createdAt}, ${target.createdAt}) AS created_at,
        COALESCE(${schema.customers.updatedAt}, ${target.updatedAt}) AS updated_at
      FROM (SELECT 1 AS _probe)
      LEFT JOIN customers ON customers.id = ${target.customerId}
      LEFT JOIN users ON users.id = ${target.ownerId}
    `,
  );
}

/**
 * Audit insert that only writes when the guarded primary row exists.
 * Bound parameters only; no PII.
 */
export function buildConditionalAuditInsertStatement(
  db: Database,
  input: {
    auditLogId: string;
    customerId: string;
    ownerId: string;
    assigneeId: string;
    backfillRunId: string;
    createdAt: string;
  },
) {
  return db.insert(schema.auditLogs).select(
    sql`
      SELECT
        ${input.auditLogId} AS id,
        NULL AS user_id,
        ${MISSING_PRIMARY_BACKFILL_AUDIT_ACTION} AS action,
        'customer' AS entity_type,
        ${input.customerId} AS entity_id,
        NULL AS ip_address,
        NULL AS user_agent,
        ${JSON.stringify({
          customerId: input.customerId,
          ownerId: input.ownerId,
          assigneeId: input.assigneeId,
          backfillRunId: input.backfillRunId,
          source: MISSING_PRIMARY_BACKFILL_SOURCE,
        })} AS metadata,
        ${input.createdAt} AS created_at
      FROM customer_assignees
      WHERE customer_assignees.id = ${input.assigneeId}
        AND customer_assignees.customer_id = ${input.customerId}
        AND customer_assignees.user_id = ${input.ownerId}
        AND customer_assignees.role = 'primary'
    `,
  );
}

async function revalidateChunkTargets(
  db: Database,
  chunk: MissingPrimaryTarget[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const target of chunk) {
    const customerRows = await db
      .select({
        status: schema.customers.status,
        ownerId: schema.customers.ownerId,
      })
      .from(schema.customers)
      .where(eq(schema.customers.id, target.customerId))
      .limit(1);
    const customer = customerRows[0];
    if (!customer) {
      return { ok: false, reason: `customer missing ${target.customerId}` };
    }
    if (customer.status === "public_pool") {
      return {
        ok: false,
        reason: `public_pool candidate ${target.customerId}`,
      };
    }
    if (customer.status !== "active") {
      return {
        ok: false,
        reason: `non-active candidate ${target.customerId} status=${customer.status}`,
      };
    }
    if (customer.ownerId !== target.ownerId) {
      return {
        ok: false,
        reason: `owner changed for ${target.customerId}`,
      };
    }

    const ownerRows = await db
      .select({
        isActive: schema.users.isActive,
        deletedAt: schema.users.deletedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, target.ownerId))
      .limit(1);
    const owner = ownerRows[0];
    if (!owner) {
      return { ok: false, reason: `owner missing ${target.ownerId}` };
    }
    if (owner.isActive !== 1) {
      return { ok: false, reason: `owner inactive ${target.ownerId}` };
    }
    if (owner.deletedAt) {
      return { ok: false, reason: `owner deleted ${target.ownerId}` };
    }

    const primaryRows = await db
      .select({ id: schema.customerAssignees.id })
      .from(schema.customerAssignees)
      .where(
        and(
          eq(schema.customerAssignees.customerId, target.customerId),
          eq(schema.customerAssignees.role, "primary"),
        ),
      )
      .limit(1);
    if (primaryRows.length > 0) {
      return {
        ok: false,
        reason: `primary already exists for ${target.customerId}`,
      };
    }

    const ownerAssignee = await db
      .select({ id: schema.customerAssignees.id })
      .from(schema.customerAssignees)
      .where(
        and(
          eq(schema.customerAssignees.customerId, target.customerId),
          eq(schema.customerAssignees.userId, target.ownerId),
        ),
      )
      .limit(1);
    if (ownerAssignee.length > 0) {
      return {
        ok: false,
        reason: `owner already assignee on ${target.customerId}`,
      };
    }

    const assigneeId = deterministicPrimaryAssigneeId(
      target.customerId,
      target.ownerId,
    );
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
      return {
        ok: false,
        reason: `deterministic id conflict for ${assigneeId}`,
      };
    }
  }

  return { ok: true };
}

async function persistManifest(
  options: MissingPrimaryApplyOptions,
  manifest: MissingPrimaryBackfillManifest,
): Promise<void> {
  manifest.updatedAt = nowIso();
  await options.onManifestUpdate(manifest);
}

/**
 * Inserts missing primary rows using migration 0025 field semantics.
 * Requires expectedCount + expectedSnapshot to match a fresh re-query.
 * Requires onManifestUpdate (fail-closed durability).
 * System actor: audit userId = null (schema allows null).
 */
export async function runMissingPrimaryApply(
  db: Database,
  options: MissingPrimaryApplyOptions,
): Promise<MissingPrimaryApplyResult> {
  if (typeof options.onManifestUpdate !== "function") {
    throw new MissingPrimaryBackfillError(
      "onManifestUpdate is required for apply (fail-closed manifest durability)",
      "MANIFEST_REQUIRED",
    );
  }
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

  const chunkSize =
    options.chunkSize ?? MISSING_PRIMARY_BACKFILL_DEFAULT_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 40) {
    throw new MissingPrimaryBackfillError(
      "chunkSize must be an integer between 1 and 40",
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
  const startedAt = nowIso();
  const manifest: MissingPrimaryBackfillManifest = {
    version: MISSING_PRIMARY_BACKFILL_MANIFEST_VERSION,
    backfillRunId,
    snapshotHash,
    expectedCount: options.expectedCount,
    startedAt,
    updatedAt: startedAt,
    status: "in_progress",
    completedChunks: 0,
    failedChunkIndex: null,
    errorCode: null,
    insertedRows: [],
  };
  await persistManifest(options, manifest);

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
      skippedAlreadyCompliant += 1;
      continue;
    }

    toInsert.push(target);
  }

  if (toInsert.length === 0) {
    manifest.status = "completed";
    await persistManifest(options, manifest);
    return {
      mode: "apply",
      backfillRunId,
      attemptedCount: fullTargets.length,
      insertedCount: 0,
      skippedAlreadyCompliant,
      manifest,
      snapshotHash,
      rowsWritten: 0,
    };
  }

  let chunkIndex = 0;
  for (let offset = 0; offset < toInsert.length; offset += chunkSize) {
    const chunk = toInsert.slice(offset, offset + chunkSize);

    const revalidation = await revalidateChunkTargets(db, chunk);
    if (!revalidation.ok) {
      manifest.status = "partial_failed";
      manifest.failedChunkIndex = chunkIndex;
      manifest.errorCode = "CHUNK_REVALIDATION_FAILED";
      await persistManifest(options, manifest);
      throw new MissingPrimaryBackfillError(
        `chunk revalidation failed: ${revalidation.reason}`,
        "CHUNK_REVALIDATION_FAILED",
        manifest,
      );
    }

    const draftRows: MissingPrimaryBackfillManifestEntry[] = chunk.map(
      (target) => ({
        assigneeId: deterministicPrimaryAssigneeId(
          target.customerId,
          target.ownerId,
        ),
        customerId: target.customerId,
        ownerId: target.ownerId,
        auditLogId: crypto.randomUUID(),
        chunkIndex,
      }),
    );

    const statements: unknown[] = [];
    const auditCreatedAt = nowIso();
    for (let i = 0; i < chunk.length; i += 1) {
      const target = chunk[i]!;
      const draft = draftRows[i]!;
      statements.push(buildGuardedPrimaryInsertStatement(db, target));
      statements.push(
        buildConditionalAuditInsertStatement(db, {
          auditLogId: draft.auditLogId,
          customerId: target.customerId,
          ownerId: target.ownerId,
          assigneeId: draft.assigneeId,
          backfillRunId,
          createdAt: auditCreatedAt,
        }),
      );
    }

    let batchResults: unknown[];
    try {
      batchResults = (await db.batch(
        statements as unknown as Parameters<Database["batch"]>[0],
      )) as unknown as unknown[];
    } catch (error) {
      manifest.status = "partial_failed";
      manifest.failedChunkIndex = chunkIndex;
      if (isConstraintNotNullError(error)) {
        manifest.errorCode = "TOCTOU_GUARD_FAILED";
        await persistManifest(options, manifest);
        throw new MissingPrimaryBackfillError(
          `statement-level TOCTOU guard failed in chunk ${chunkIndex}`,
          "TOCTOU_GUARD_FAILED",
          manifest,
        );
      }
      manifest.errorCode = "PARTIAL_CHUNK_FAILED";
      await persistManifest(options, manifest);
      throw new MissingPrimaryBackfillError(
        `chunk ${chunkIndex} batch failed`,
        "PARTIAL_CHUNK_FAILED",
        manifest,
      );
    }

    for (let i = 0; i < chunk.length; i += 1) {
      const primaryResult = batchResults[i * 2];
      const auditResult = batchResults[i * 2 + 1];
      const primaryChanges = extractChanges(primaryResult);
      const auditChanges = extractChanges(auditResult);

      if (primaryChanges !== 1 || auditChanges !== 1) {
        // Should be unreachable when NULL-id abort works; fail closed if API drifts.
        manifest.status = "partial_failed";
        manifest.failedChunkIndex = chunkIndex;
        manifest.errorCode = "TOCTOU_GUARD_FAILED";
        await persistManifest(options, manifest);
        throw new MissingPrimaryBackfillError(
          `affected-row guard failed in chunk ${chunkIndex} (primary=${primaryChanges} audit=${auditChanges})`,
          "TOCTOU_GUARD_FAILED",
          manifest,
        );
      }
    }

    manifest.insertedRows.push(...draftRows);
    manifest.completedChunks = chunkIndex + 1;
    await persistManifest(options, manifest);
    chunkIndex += 1;
  }

  manifest.status = "completed";
  await persistManifest(options, manifest);

  return {
    mode: "apply",
    backfillRunId,
    attemptedCount: fullTargets.length,
    insertedCount: manifest.insertedRows.length,
    skippedAlreadyCompliant,
    manifest,
    snapshotHash,
    rowsWritten: manifest.insertedRows.length,
  };
}

/**
 * Deletes only primary rows listed in the manifest insertedRows.
 * Re-checks assignee identity AND customers.ownerId before delete.
 * Primary delete + rollback audit share one atomic batch per chunk.
 */
export async function rollbackMissingPrimaryBackfill(
  db: Database,
  insertedRows: MissingPrimaryBackfillManifestEntry[],
  options: MissingPrimaryRollbackOptions,
): Promise<MissingPrimaryRollbackResult> {
  if (typeof options.onManifestUpdate !== "function") {
    throw new MissingPrimaryRollbackError(
      "onManifestUpdate is required for rollback",
      "MANIFEST_REQUIRED",
    );
  }
  if (
    typeof options.originalBackfillRunId !== "string" ||
    options.originalBackfillRunId.length === 0
  ) {
    throw new MissingPrimaryRollbackError(
      "originalBackfillRunId is required",
      "INVALID_OPTIONS",
    );
  }

  const chunkSize =
    options.chunkSize ?? MISSING_PRIMARY_BACKFILL_DEFAULT_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 40) {
    throw new MissingPrimaryRollbackError(
      "chunkSize must be an integer between 1 and 40",
      "INVALID_OPTIONS",
    );
  }

  const rollbackRunId = options.rollbackRunId ?? crypto.randomUUID();
  const startedAt = nowIso();
  const manifest: MissingPrimaryRollbackManifest = {
    version: MISSING_PRIMARY_BACKFILL_MANIFEST_VERSION,
    rollbackRunId,
    originalBackfillRunId: options.originalBackfillRunId,
    startedAt,
    updatedAt: startedAt,
    status: "in_progress",
    completedChunks: 0,
    failedChunkIndex: null,
    errorCode: null,
    deletedRows: [],
    skipped: [],
  };
  await options.onManifestUpdate(manifest);

  const deletable: Array<{
    entry: MissingPrimaryBackfillManifestEntry;
    rollbackAuditLogId: string;
  }> = [];

  for (const entry of insertedRows) {
    const assigneeRows = await db
      .select({
        id: schema.customerAssignees.id,
        role: schema.customerAssignees.role,
        customerId: schema.customerAssignees.customerId,
        userId: schema.customerAssignees.userId,
      })
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, entry.assigneeId))
      .limit(1);

    const row = assigneeRows[0];
    if (!row) {
      manifest.skipped.push({
        assigneeId: entry.assigneeId,
        customerId: entry.customerId,
        ownerId: entry.ownerId,
        reason: "assignee_missing",
      });
      continue;
    }
    if (row.role !== "primary") {
      manifest.skipped.push({
        assigneeId: entry.assigneeId,
        customerId: entry.customerId,
        ownerId: entry.ownerId,
        reason: "role_mismatch",
      });
      continue;
    }
    if (row.customerId !== entry.customerId) {
      manifest.skipped.push({
        assigneeId: entry.assigneeId,
        customerId: entry.customerId,
        ownerId: entry.ownerId,
        reason: "customer_mismatch",
      });
      continue;
    }
    if (row.userId !== entry.ownerId) {
      manifest.skipped.push({
        assigneeId: entry.assigneeId,
        customerId: entry.customerId,
        ownerId: entry.ownerId,
        reason: "user_mismatch",
      });
      continue;
    }

    const customerRows = await db
      .select({ ownerId: schema.customers.ownerId })
      .from(schema.customers)
      .where(eq(schema.customers.id, entry.customerId))
      .limit(1);
    const currentOwnerId = customerRows[0]?.ownerId ?? null;
    if (currentOwnerId !== entry.ownerId) {
      manifest.skipped.push({
        assigneeId: entry.assigneeId,
        customerId: entry.customerId,
        ownerId: entry.ownerId,
        reason: "owner_transferred",
      });
      continue;
    }

    deletable.push({
      entry,
      rollbackAuditLogId: crypto.randomUUID(),
    });
  }

  manifest.updatedAt = nowIso();
  await options.onManifestUpdate(manifest);

  let chunkIndex = 0;
  for (let offset = 0; offset < deletable.length; offset += chunkSize) {
    const chunk = deletable.slice(offset, offset + chunkSize);
    const statements: unknown[] = [];
    const auditCreatedAt = nowIso();

    for (const item of chunk) {
      const { entry, rollbackAuditLogId } = item;
      // Re-check owner + identity in the DELETE WHERE (statement-level).
      statements.push(
        db
          .delete(schema.customerAssignees)
          .where(
            and(
              eq(schema.customerAssignees.id, entry.assigneeId),
              eq(schema.customerAssignees.customerId, entry.customerId),
              eq(schema.customerAssignees.userId, entry.ownerId),
              eq(schema.customerAssignees.role, "primary"),
              sql`EXISTS (
                SELECT 1 FROM customers c
                WHERE c.id = ${entry.customerId}
                  AND c.owner_id = ${entry.ownerId}
              )`,
            ),
          ),
      );
      // Fail closed: if DELETE was a no-op (race), id becomes NULL and the
      // whole chunk batch aborts — D1 cannot RAISE outside triggers.
      statements.push(
        db.insert(schema.auditLogs).select(
          sql`
            SELECT
              CASE
                WHEN NOT EXISTS (
                  SELECT 1 FROM customer_assignees ca
                  WHERE ca.id = ${entry.assigneeId}
                )
                AND EXISTS (
                  SELECT 1 FROM customers c
                  WHERE c.id = ${entry.customerId}
                    AND c.owner_id = ${entry.ownerId}
                )
                THEN ${rollbackAuditLogId}
                ELSE NULL
              END AS id,
              NULL AS user_id,
              ${MISSING_PRIMARY_BACKFILL_ROLLBACK_AUDIT_ACTION} AS action,
              'customer' AS entity_type,
              ${entry.customerId} AS entity_id,
              NULL AS ip_address,
              NULL AS user_agent,
              ${JSON.stringify({
                customerId: entry.customerId,
                ownerId: entry.ownerId,
                assigneeId: entry.assigneeId,
                originalBackfillRunId: options.originalBackfillRunId,
                rollbackRunId,
                source: MISSING_PRIMARY_BACKFILL_SOURCE,
              })} AS metadata,
              ${auditCreatedAt} AS created_at
            FROM (SELECT 1 AS _probe)
          `,
        ),
      );
    }

    let batchResults: unknown[];
    try {
      batchResults = (await db.batch(
        statements as unknown as Parameters<Database["batch"]>[0],
      )) as unknown as unknown[];
    } catch {
      manifest.status = "partial_failed";
      manifest.failedChunkIndex = chunkIndex;
      manifest.errorCode = "PARTIAL_CHUNK_FAILED";
      manifest.updatedAt = nowIso();
      await options.onManifestUpdate(manifest);
      throw new MissingPrimaryRollbackError(
        `rollback chunk ${chunkIndex} batch failed`,
        "PARTIAL_CHUNK_FAILED",
        manifest,
      );
    }

    for (let i = 0; i < chunk.length; i += 1) {
      const deleteChanges = extractChanges(batchResults[i * 2]);
      const auditChanges = extractChanges(batchResults[i * 2 + 1]);
      const item = chunk[i]!;

      if (deleteChanges === 1 && auditChanges === 1) {
        manifest.deletedRows.push({
          assigneeId: item.entry.assigneeId,
          customerId: item.entry.customerId,
          ownerId: item.entry.ownerId,
          rollbackAuditLogId: item.rollbackAuditLogId,
          chunkIndex,
        });
      } else if (deleteChanges === 0) {
        // Row vanished or owner changed between pre-check and delete.
        manifest.skipped.push({
          assigneeId: item.entry.assigneeId,
          customerId: item.entry.customerId,
          ownerId: item.entry.ownerId,
          reason: "replaced_primary",
        });
      } else {
        manifest.status = "partial_failed";
        manifest.failedChunkIndex = chunkIndex;
        manifest.errorCode = "PARTIAL_CHUNK_FAILED";
        manifest.updatedAt = nowIso();
        await options.onManifestUpdate(manifest);
        throw new MissingPrimaryRollbackError(
          `rollback affected-row mismatch in chunk ${chunkIndex} (delete=${deleteChanges} audit=${auditChanges})`,
          "PARTIAL_CHUNK_FAILED",
          manifest,
        );
      }
    }

    manifest.completedChunks = chunkIndex + 1;
    manifest.updatedAt = nowIso();
    await options.onManifestUpdate(manifest);
    chunkIndex += 1;
  }

  manifest.status = "completed";
  manifest.updatedAt = nowIso();
  await options.onManifestUpdate(manifest);

  return {
    deletedCount: manifest.deletedRows.length,
    skippedCount: manifest.skipped.length,
    skipped: manifest.skipped,
    manifest,
  };
}
