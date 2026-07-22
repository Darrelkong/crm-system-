import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import type {
  PublicPoolQuickEntrySubmission,
  PublicPoolQuickEntrySubmissionRow,
  QuickEntryDuplicateField,
  QuickEntrySubmissionRowStatus,
} from "../../../drizzle/schema/public-pool-quick-entry-submissions";
import {
  QUICK_ENTRY_BATCH_MAX_ROWS,
  QUICK_ENTRY_ROW_STATUS_CREATED,
  QUICK_ENTRY_ROW_STATUS_DUPLICATE,
  QUICK_ENTRY_ROW_STATUS_FAILED,
  QUICK_ENTRY_ROW_STATUS_INVALID,
  QUICK_ENTRY_SUBMISSION_CLEANUP_LIMIT,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES,
  QUICK_ENTRY_SUBMISSION_LEASE_SECONDS,
  QUICK_ENTRY_SUBMISSION_RETENTION_DAYS,
  QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED,
  QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING,
} from "@/lib/public-pool/quick-entry-submission-constants";
import {
  validateQuickEntryClientRowId,
  validateQuickEntrySubmissionId,
} from "@/lib/public-pool/quick-entry-submission-validation";

export type QuickEntrySubmissionRecord = PublicPoolQuickEntrySubmission;
export type QuickEntrySubmissionRowRecord = PublicPoolQuickEntrySubmissionRow;

export class QuickEntrySubmissionError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "QuickEntrySubmissionError";
  }
}

export type CreateOrLoadSubmissionResult =
  | {
      state: "created";
      submission: QuickEntrySubmissionRecord;
    }
  | {
      state: "completed";
      submission: QuickEntrySubmissionRecord;
      rows: QuickEntrySubmissionRowRecord[];
    }
  | {
      state: "processing";
      submission: QuickEntrySubmissionRecord;
      retryAfterSeconds: number;
    }
  | {
      state: "reclaimed";
      submission: QuickEntrySubmissionRecord;
      existingRows: QuickEntrySubmissionRowRecord[];
    };

export type TerminalRowInput = {
  submissionDbId: string;
  clientRowId: string;
  rowIndex: number;
  status: QuickEntrySubmissionRowStatus;
  errorCode?: string | null;
  duplicateField?: QuickEntryDuplicateField | null;
  customerId?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  now?: Date;
};

/** Public lease-scoped terminal row input — never accepts submissionDbId. */
export type LeaseTerminalRowInput = {
  actorUserId: string;
  submissionId: string;
  expectedProcessingStartedAt: string;
  clientRowId: string;
  rowIndex: number;
  status: QuickEntrySubmissionRowStatus;
  errorCode?: string | null;
  duplicateField?: QuickEntryDuplicateField | null;
  customerId?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  now?: Date;
};

function resolveDb(db?: Database): Database {
  return db ?? getDb();
}

function toIso(now: Date): string {
  return now.toISOString();
}

function addDaysIso(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function staleBeforeIso(now: Date): string {
  return new Date(
    now.getTime() - QUICK_ENTRY_SUBMISSION_LEASE_SECONDS * 1000,
  ).toISOString();
}

function retryAfterSeconds(
  processingStartedAt: string,
  now: Date,
): number {
  const started = new Date(processingStartedAt).getTime();
  const unlockAt = started + QUICK_ENTRY_SUBMISSION_LEASE_SECONDS * 1000;
  return Math.max(1, Math.ceil((unlockAt - now.getTime()) / 1000));
}

function assertTerminalRowFields(input: {
  status: QuickEntrySubmissionRowStatus;
  errorCode?: string | null;
  duplicateField?: QuickEntryDuplicateField | null;
  customerId?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
}): {
  errorCode: string | null;
  duplicateField: QuickEntryDuplicateField | null;
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
} {
  if (input.status === QUICK_ENTRY_ROW_STATUS_CREATED) {
    if (!input.customerId || !input.customerCode || !input.customerName) {
      throw new QuickEntrySubmissionError(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
        "created row 需要 customerId／customerCode／customerName",
      );
    }
    if (input.errorCode != null || input.duplicateField != null) {
      throw new QuickEntrySubmissionError(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
        "created row 不得带 errorCode／duplicateField",
      );
    }
    return {
      errorCode: null,
      duplicateField: null,
      customerId: input.customerId,
      customerCode: input.customerCode,
      customerName: input.customerName,
    };
  }

  if (input.status === QUICK_ENTRY_ROW_STATUS_DUPLICATE) {
    if (!input.errorCode) {
      throw new QuickEntrySubmissionError(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
        "duplicate row 需要 errorCode",
      );
    }
    if (
      input.duplicateField !== "phone" &&
      input.duplicateField !== "wechatId"
    ) {
      throw new QuickEntrySubmissionError(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
        "duplicate row 需要 duplicateField",
      );
    }
    if (input.customerId || input.customerCode || input.customerName) {
      throw new QuickEntrySubmissionError(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
        "duplicate row 不得带 customer 字段",
      );
    }
    return {
      errorCode: input.errorCode,
      duplicateField: input.duplicateField,
      customerId: null,
      customerCode: null,
      customerName: null,
    };
  }

  if (
    input.status === QUICK_ENTRY_ROW_STATUS_INVALID ||
    input.status === QUICK_ENTRY_ROW_STATUS_FAILED
  ) {
    if (!input.errorCode) {
      throw new QuickEntrySubmissionError(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
        `${input.status} row 需要 errorCode`,
      );
    }
    if (
      input.duplicateField != null ||
      input.customerId ||
      input.customerCode ||
      input.customerName
    ) {
      throw new QuickEntrySubmissionError(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
        `${input.status} row 字段组合无效`,
      );
    }
    return {
      errorCode: input.errorCode,
      duplicateField: null,
      customerId: null,
      customerCode: null,
      customerName: null,
    };
  }

  throw new QuickEntrySubmissionError(
    QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
    "不支持的 row status",
  );
}

function rowsMatch(
  existing: QuickEntrySubmissionRowRecord,
  expected: {
    clientRowId: string;
    rowIndex: number;
    status: QuickEntrySubmissionRowStatus;
    errorCode: string | null;
    duplicateField: QuickEntryDuplicateField | null;
    customerId: string | null;
    customerCode: string | null;
    customerName: string | null;
  },
): boolean {
  return (
    existing.clientRowId === expected.clientRowId &&
    existing.rowIndex === expected.rowIndex &&
    existing.status === expected.status &&
    (existing.errorCode ?? null) === expected.errorCode &&
    (existing.duplicateField ?? null) === expected.duplicateField &&
    (existing.customerId ?? null) === expected.customerId &&
    (existing.customerCode ?? null) === expected.customerCode &&
    (existing.customerName ?? null) === expected.customerName
  );
}

export async function getSubmissionByActorAndClientId(input: {
  actorUserId: string;
  submissionId: string;
  db?: Database;
}): Promise<QuickEntrySubmissionRecord | null> {
  const database = resolveDb(input.db);
  const rows = await database
    .select()
    .from(schema.publicPoolQuickEntrySubmissions)
    .where(
      and(
        eq(schema.publicPoolQuickEntrySubmissions.actorUserId, input.actorUserId),
        eq(
          schema.publicPoolQuickEntrySubmissions.submissionId,
          input.submissionId,
        ),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listSubmissionRows(input: {
  submissionDbId: string;
  db?: Database;
}): Promise<QuickEntrySubmissionRowRecord[]> {
  const database = resolveDb(input.db);
  return database
    .select()
    .from(schema.publicPoolQuickEntrySubmissionRows)
    .where(
      eq(
        schema.publicPoolQuickEntrySubmissionRows.submissionDbId,
        input.submissionDbId,
      ),
    )
    .orderBy(asc(schema.publicPoolQuickEntrySubmissionRows.rowIndex));
}

export async function getSubmissionRowByIndex(input: {
  submissionDbId: string;
  rowIndex: number;
  db?: Database;
}): Promise<QuickEntrySubmissionRowRecord | null> {
  const database = resolveDb(input.db);
  const rows = await database
    .select()
    .from(schema.publicPoolQuickEntrySubmissionRows)
    .where(
      and(
        eq(
          schema.publicPoolQuickEntrySubmissionRows.submissionDbId,
          input.submissionDbId,
        ),
        eq(schema.publicPoolQuickEntrySubmissionRows.rowIndex, input.rowIndex),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getSubmissionRowByClientRowId(input: {
  submissionDbId: string;
  clientRowId: string;
  db?: Database;
}): Promise<QuickEntrySubmissionRowRecord | null> {
  const database = resolveDb(input.db);
  const rows = await database
    .select()
    .from(schema.publicPoolQuickEntrySubmissionRows)
    .where(
      and(
        eq(
          schema.publicPoolQuickEntrySubmissionRows.submissionDbId,
          input.submissionDbId,
        ),
        eq(
          schema.publicPoolQuickEntrySubmissionRows.clientRowId,
          input.clientRowId,
        ),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Builds a terminal row INSERT statement for inclusion in db.batch.
 * Does not execute. Terminal rows must not use ON CONFLICT DO UPDATE.
 */
export function buildInsertQuickEntrySubmissionRowStatement(
  db: Database,
  input: TerminalRowInput & { nowIso?: string; id?: string },
) {
  const fields = assertTerminalRowFields(input);
  const nowIso = input.nowIso ?? toIso(input.now ?? new Date());
  return db.insert(schema.publicPoolQuickEntrySubmissionRows).values({
    id: input.id ?? crypto.randomUUID(),
    submissionDbId: input.submissionDbId,
    clientRowId: input.clientRowId,
    rowIndex: input.rowIndex,
    status: input.status,
    errorCode: fields.errorCode,
    duplicateField: fields.duplicateField,
    customerId: fields.customerId,
    customerCode: fields.customerCode,
    customerName: fields.customerName,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

export async function insertTerminalSubmissionRow(input: TerminalRowInput & {
  db?: Database;
}): Promise<
  | { state: "inserted"; row: QuickEntrySubmissionRowRecord }
  | { state: "existing"; row: QuickEntrySubmissionRowRecord }
> {
  const database = resolveDb(input.db);
  const fields = assertTerminalRowFields(input);
  const nowIso = toIso(input.now ?? new Date());
  const id = crypto.randomUUID();

  try {
    await buildInsertQuickEntrySubmissionRowStatement(database, {
      ...input,
      id,
      nowIso,
    });
  } catch {
    const byClient = await getSubmissionRowByClientRowId({
      submissionDbId: input.submissionDbId,
      clientRowId: input.clientRowId,
      db: database,
    });
    const byIndex = await getSubmissionRowByIndex({
      submissionDbId: input.submissionDbId,
      rowIndex: input.rowIndex,
      db: database,
    });
    const existing = byClient ?? byIndex;
    if (
      existing &&
      rowsMatch(existing, {
        clientRowId: input.clientRowId,
        rowIndex: input.rowIndex,
        status: input.status,
        errorCode: fields.errorCode,
        duplicateField: fields.duplicateField,
        customerId: fields.customerId,
        customerCode: fields.customerCode,
        customerName: fields.customerName,
      })
    ) {
      return { state: "existing", row: existing };
    }
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ROW_CONFLICT,
      "submission row 终态冲突",
    );
  }

  const row = await getSubmissionRowByClientRowId({
    submissionDbId: input.submissionDbId,
    clientRowId: input.clientRowId,
    db: database,
  });
  if (!row) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_NOT_FOUND,
      "submission row 写入后未找到",
    );
  }
  return { state: "inserted", row };
}

async function interpretExistingSubmission(input: {
  submission: QuickEntrySubmissionRecord;
  requestHash: string;
  now: Date;
  db: Database;
}): Promise<CreateOrLoadSubmissionResult> {
  const { submission, requestHash, now, db } = input;

  if (submission.requestHash !== requestHash) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      "submissionId 与既有请求内容冲突",
    );
  }

  if (submission.status === QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED) {
    const rows = await listSubmissionRows({
      submissionDbId: submission.id,
      db,
    });
    return { state: "completed", submission, rows };
  }

  const isStale = submission.processingStartedAt <= staleBeforeIso(now);
  if (!isStale) {
    return {
      state: "processing",
      submission,
      retryAfterSeconds: retryAfterSeconds(submission.processingStartedAt, now),
    };
  }

  const nowIso = toIso(now);
  const reclaimed = await db
    .update(schema.publicPoolQuickEntrySubmissions)
    .set({
      processingStartedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(schema.publicPoolQuickEntrySubmissions.id, submission.id),
        eq(
          schema.publicPoolQuickEntrySubmissions.status,
          QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING,
        ),
        eq(
          schema.publicPoolQuickEntrySubmissions.processingStartedAt,
          submission.processingStartedAt,
        ),
        lte(
          schema.publicPoolQuickEntrySubmissions.processingStartedAt,
          staleBeforeIso(now),
        ),
      ),
    )
    .returning();

  if (reclaimed[0]) {
    const existingRows = await listSubmissionRows({
      submissionDbId: submission.id,
      db,
    });
    return {
      state: "reclaimed",
      submission: reclaimed[0],
      existingRows,
    };
  }

  const refreshed = await getSubmissionByActorAndClientId({
    actorUserId: submission.actorUserId,
    submissionId: submission.submissionId,
    db,
  });
  if (!refreshed) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_NOT_FOUND,
      "submission 不存在",
    );
  }
  return interpretExistingSubmission({
    submission: refreshed,
    requestHash,
    now,
    db,
  });
}

export async function createOrLoadSubmission(input: {
  actorUserId: string;
  submissionId: string;
  requestHash: string;
  rowCount: number;
  now?: Date;
  db?: Database;
}): Promise<CreateOrLoadSubmissionResult> {
  const database = resolveDb(input.db);
  const now = input.now ?? new Date();
  const nowIso = toIso(now);

  if (
    !Number.isInteger(input.rowCount) ||
    input.rowCount < 1 ||
    input.rowCount > 20
  ) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
      "rowCount 无效",
    );
  }

  const existing = await getSubmissionByActorAndClientId({
    actorUserId: input.actorUserId,
    submissionId: input.submissionId,
    db: database,
  });
  if (existing) {
    return interpretExistingSubmission({
      submission: existing,
      requestHash: input.requestHash,
      now,
      db: database,
    });
  }

  const id = crypto.randomUUID();
  try {
    await database.insert(schema.publicPoolQuickEntrySubmissions).values({
      id,
      actorUserId: input.actorUserId,
      submissionId: input.submissionId,
      requestHash: input.requestHash,
      status: QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING,
      rowCount: input.rowCount,
      createdCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      failedCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      processingStartedAt: nowIso,
      completedAt: null,
      expiresAt: addDaysIso(now, QUICK_ENTRY_SUBMISSION_RETENTION_DAYS),
    });
  } catch {
    const raced = await getSubmissionByActorAndClientId({
      actorUserId: input.actorUserId,
      submissionId: input.submissionId,
      db: database,
    });
    if (!raced) {
      throw new QuickEntrySubmissionError(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_NOT_FOUND,
        "submission 建立失败",
      );
    }
    return interpretExistingSubmission({
      submission: raced,
      requestHash: input.requestHash,
      now,
      db: database,
    });
  }

  const created = await getSubmissionByActorAndClientId({
    actorUserId: input.actorUserId,
    submissionId: input.submissionId,
    db: database,
  });
  if (!created) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_NOT_FOUND,
      "submission 建立后未找到",
    );
  }
  return { state: "created", submission: created };
}

export async function completeQuickEntrySubmission(input: {
  submissionDbId: string;
  now?: Date;
  db?: Database;
}): Promise<{
  submission: QuickEntrySubmissionRecord;
  rows: QuickEntrySubmissionRowRecord[];
}> {
  const database = resolveDb(input.db);
  const now = input.now ?? new Date();
  const nowIso = toIso(now);

  const currentRows = await database
    .select()
    .from(schema.publicPoolQuickEntrySubmissions)
    .where(eq(schema.publicPoolQuickEntrySubmissions.id, input.submissionDbId))
    .limit(1);
  const current = currentRows[0];
  if (!current) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_NOT_FOUND,
      "submission 不存在",
    );
  }

  const rows = await listSubmissionRows({
    submissionDbId: input.submissionDbId,
    db: database,
  });

  if (current.status === QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED) {
    return { submission: current, rows };
  }

  if (rows.length !== current.rowCount) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_INCOMPLETE,
      "submission rows 未齐",
    );
  }

  let createdCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;
  let failedCount = 0;
  for (const row of rows) {
    if (row.status === QUICK_ENTRY_ROW_STATUS_CREATED) createdCount += 1;
    else if (row.status === QUICK_ENTRY_ROW_STATUS_DUPLICATE) duplicateCount += 1;
    else if (row.status === QUICK_ENTRY_ROW_STATUS_INVALID) invalidCount += 1;
    else if (row.status === QUICK_ENTRY_ROW_STATUS_FAILED) failedCount += 1;
  }

  const updated = await database
    .update(schema.publicPoolQuickEntrySubmissions)
    .set({
      status: QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED,
      createdCount,
      duplicateCount,
      invalidCount,
      failedCount,
      completedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(schema.publicPoolQuickEntrySubmissions.id, input.submissionDbId),
        eq(
          schema.publicPoolQuickEntrySubmissions.status,
          QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING,
        ),
      ),
    )
    .returning();

  if (updated[0]) {
    return { submission: updated[0], rows };
  }

  const refreshedRows = await database
    .select()
    .from(schema.publicPoolQuickEntrySubmissions)
    .where(eq(schema.publicPoolQuickEntrySubmissions.id, input.submissionDbId))
    .limit(1);
  const refreshed = refreshedRows[0];
  if (!refreshed || refreshed.status !== QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_INCOMPLETE,
      "submission 完成失败",
    );
  }
  const ordered = await listSubmissionRows({
    submissionDbId: input.submissionDbId,
    db: database,
  });
  return { submission: refreshed, rows: ordered };
}

export async function cleanupExpiredQuickEntrySubmissions(input?: {
  now?: Date;
  limit?: number;
  db?: Database;
}): Promise<{ deletedCount: number }> {
  const database = resolveDb(input?.db);
  const now = input?.now ?? new Date();
  const nowIso = toIso(now);
  const requested = input?.limit ?? QUICK_ENTRY_SUBMISSION_CLEANUP_LIMIT;
  const limit = Math.min(
    QUICK_ENTRY_SUBMISSION_CLEANUP_LIMIT,
    Math.max(1, Math.floor(Number.isFinite(requested) ? requested : 1)),
  );

  const expired = await database
    .select({ id: schema.publicPoolQuickEntrySubmissions.id })
    .from(schema.publicPoolQuickEntrySubmissions)
    .where(lte(schema.publicPoolQuickEntrySubmissions.expiresAt, nowIso))
    .orderBy(asc(schema.publicPoolQuickEntrySubmissions.expiresAt))
    .limit(limit);

  if (expired.length === 0) {
    return { deletedCount: 0 };
  }

  const ids = expired.map((row) => row.id);
  await database
    .delete(schema.publicPoolQuickEntrySubmissions)
    .where(inArray(schema.publicPoolQuickEntrySubmissions.id, ids));

  return { deletedCount: ids.length };
}

export function getQuickEntrySubmissionStaleBefore(now: Date): string {
  return staleBeforeIso(now);
}

function assertLeaseIso(value: string): void {
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
      "expectedProcessingStartedAt 无效",
    );
  }
}

function assertLeaseRowGuards(input: LeaseTerminalRowInput): void {
  if (!input.actorUserId || typeof input.actorUserId !== "string") {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
      "actorUserId 无效",
    );
  }
  const submissionId = validateQuickEntrySubmissionId(input.submissionId);
  if (!submissionId.ok) {
    throw new QuickEntrySubmissionError(
      submissionId.errorCode,
      submissionId.message,
    );
  }
  const clientRowId = validateQuickEntryClientRowId(input.clientRowId);
  if (!clientRowId.ok) {
    throw new QuickEntrySubmissionError(
      clientRowId.errorCode,
      clientRowId.message,
    );
  }
  assertLeaseIso(input.expectedProcessingStartedAt);
  if (
    !Number.isInteger(input.rowIndex) ||
    input.rowIndex < 0 ||
    input.rowIndex >= QUICK_ENTRY_BATCH_MAX_ROWS
  ) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
      "rowIndex 无效",
    );
  }
}

/**
 * Builds a lease-bound terminal row INSERT for db.batch.
 * submission_db_id is a scalar subquery that requires actor + submissionId +
 * status=processing + processing_started_at match. Failure → NOT NULL / batch rollback.
 * Does not accept Client submissionDbId.
 */
export function buildInsertQuickEntrySubmissionRowForLeaseStatement(
  db: Database,
  input: LeaseTerminalRowInput & { nowIso?: string; id?: string },
) {
  assertLeaseRowGuards(input);
  const fields = assertTerminalRowFields(input);
  const nowIso = input.nowIso ?? toIso(input.now ?? new Date());
  return db.insert(schema.publicPoolQuickEntrySubmissionRows).values({
    id: input.id ?? crypto.randomUUID(),
    submissionDbId: sql`(
      SELECT id
      FROM public_pool_quick_entry_submissions
      WHERE actor_user_id = ${input.actorUserId}
        AND submission_id = ${input.submissionId}
        AND status = ${QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING}
        AND processing_started_at = ${input.expectedProcessingStartedAt}
    )`,
    clientRowId: input.clientRowId,
    rowIndex: input.rowIndex,
    status: input.status,
    errorCode: fields.errorCode,
    duplicateField: fields.duplicateField,
    customerId: fields.customerId,
    customerCode: fields.customerCode,
    customerName: fields.customerName,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

async function classifyLeaseFailure(input: {
  actorUserId: string;
  submissionId: string;
  expectedProcessingStartedAt: string;
  db: Database;
}): Promise<never> {
  const submission = await getSubmissionByActorAndClientId({
    actorUserId: input.actorUserId,
    submissionId: input.submissionId,
    db: input.db,
  });
  if (!submission) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_NOT_FOUND,
      "submission 不存在",
    );
  }
  if (submission.status === QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ALREADY_COMPLETED,
      "submission 已完成",
    );
  }
  if (submission.processingStartedAt !== input.expectedProcessingStartedAt) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_LEASE_LOST,
      "submission lease 已失效",
    );
  }
  throw new QuickEntrySubmissionError(
    QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_LEASE_LOST,
    "submission lease 写入失败",
  );
}

export async function insertTerminalSubmissionRowForLease(
  input: LeaseTerminalRowInput & { db?: Database },
): Promise<
  | { state: "inserted"; row: QuickEntrySubmissionRowRecord }
  | { state: "existing"; row: QuickEntrySubmissionRowRecord }
> {
  assertLeaseRowGuards(input);
  const database = resolveDb(input.db);
  const fields = assertTerminalRowFields(input);
  const nowIso = toIso(input.now ?? new Date());
  const id = crypto.randomUUID();

  try {
    await buildInsertQuickEntrySubmissionRowForLeaseStatement(database, {
      ...input,
      id,
      nowIso,
    });
  } catch (err) {
    if (err instanceof QuickEntrySubmissionError) throw err;

    const submission = await getSubmissionByActorAndClientId({
      actorUserId: input.actorUserId,
      submissionId: input.submissionId,
      db: database,
    });
    if (!submission) {
      throw new QuickEntrySubmissionError(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_NOT_FOUND,
        "submission 不存在",
      );
    }
    if (
      submission.status !== QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING ||
      submission.processingStartedAt !== input.expectedProcessingStartedAt
    ) {
      await classifyLeaseFailure({
        actorUserId: input.actorUserId,
        submissionId: input.submissionId,
        expectedProcessingStartedAt: input.expectedProcessingStartedAt,
        db: database,
      });
    }

    const byClient = await getSubmissionRowByClientRowId({
      submissionDbId: submission.id,
      clientRowId: input.clientRowId,
      db: database,
    });
    const byIndex = await getSubmissionRowByIndex({
      submissionDbId: submission.id,
      rowIndex: input.rowIndex,
      db: database,
    });
    const existing = byClient ?? byIndex;
    if (
      existing &&
      rowsMatch(existing, {
        clientRowId: input.clientRowId,
        rowIndex: input.rowIndex,
        status: input.status,
        errorCode: fields.errorCode,
        duplicateField: fields.duplicateField,
        customerId: fields.customerId,
        customerCode: fields.customerCode,
        customerName: fields.customerName,
      })
    ) {
      return { state: "existing", row: existing };
    }
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ROW_CONFLICT,
      "submission row 终态冲突",
    );
  }

  const submission = await getSubmissionByActorAndClientId({
    actorUserId: input.actorUserId,
    submissionId: input.submissionId,
    db: database,
  });
  if (!submission) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_NOT_FOUND,
      "submission 不存在",
    );
  }
  const row = await getSubmissionRowByClientRowId({
    submissionDbId: submission.id,
    clientRowId: input.clientRowId,
    db: database,
  });
  if (!row) {
    await classifyLeaseFailure({
      actorUserId: input.actorUserId,
      submissionId: input.submissionId,
      expectedProcessingStartedAt: input.expectedProcessingStartedAt,
      db: database,
    });
  }
  return { state: "inserted", row: row! };
}

export async function renewQuickEntrySubmissionLease(input: {
  actorUserId: string;
  submissionId: string;
  expectedProcessingStartedAt: string;
  now?: Date;
  db?: Database;
}): Promise<{
  state: "renewed";
  submission: QuickEntrySubmissionRecord;
  processingStartedAt: string;
}> {
  assertLeaseIso(input.expectedProcessingStartedAt);
  const database = resolveDb(input.db);
  const now = input.now ?? new Date();
  const nowIso = toIso(now);

  const updated = await database
    .update(schema.publicPoolQuickEntrySubmissions)
    .set({
      processingStartedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(schema.publicPoolQuickEntrySubmissions.actorUserId, input.actorUserId),
        eq(
          schema.publicPoolQuickEntrySubmissions.submissionId,
          input.submissionId,
        ),
        eq(
          schema.publicPoolQuickEntrySubmissions.status,
          QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING,
        ),
        eq(
          schema.publicPoolQuickEntrySubmissions.processingStartedAt,
          input.expectedProcessingStartedAt,
        ),
      ),
    )
    .returning();

  if (updated[0]) {
    return {
      state: "renewed",
      submission: updated[0],
      processingStartedAt: updated[0].processingStartedAt,
    };
  }

  const refreshed = await getSubmissionByActorAndClientId({
    actorUserId: input.actorUserId,
    submissionId: input.submissionId,
    db: database,
  });
  if (!refreshed) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_NOT_FOUND,
      "submission 不存在",
    );
  }
  if (refreshed.status === QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ALREADY_COMPLETED,
      "submission 已完成",
    );
  }
  throw new QuickEntrySubmissionError(
    QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_LEASE_LOST,
    "submission lease 已失效",
  );
}

export async function completeQuickEntrySubmissionForLease(input: {
  actorUserId: string;
  submissionId: string;
  expectedProcessingStartedAt: string;
  now?: Date;
  db?: Database;
}): Promise<{
  submission: QuickEntrySubmissionRecord;
  rows: QuickEntrySubmissionRowRecord[];
}> {
  assertLeaseIso(input.expectedProcessingStartedAt);
  const database = resolveDb(input.db);
  const now = input.now ?? new Date();
  const nowIso = toIso(now);

  const current = await getSubmissionByActorAndClientId({
    actorUserId: input.actorUserId,
    submissionId: input.submissionId,
    db: database,
  });
  if (!current) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_NOT_FOUND,
      "submission 不存在",
    );
  }

  const rows = await listSubmissionRows({
    submissionDbId: current.id,
    db: database,
  });

  if (current.status === QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED) {
    return { submission: current, rows };
  }

  if (current.processingStartedAt !== input.expectedProcessingStartedAt) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_LEASE_LOST,
      "submission lease 已失效",
    );
  }

  if (rows.length !== current.rowCount) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_INCOMPLETE,
      "submission rows 未齐",
    );
  }

  const indexSet = new Set(rows.map((row) => row.rowIndex));
  for (let i = 0; i < current.rowCount; i += 1) {
    if (!indexSet.has(i)) {
      throw new QuickEntrySubmissionError(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_INCOMPLETE,
        "submission rowIndex 不完整",
      );
    }
  }

  let createdCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;
  let failedCount = 0;
  for (const row of rows) {
    if (row.status === QUICK_ENTRY_ROW_STATUS_CREATED) createdCount += 1;
    else if (row.status === QUICK_ENTRY_ROW_STATUS_DUPLICATE) duplicateCount += 1;
    else if (row.status === QUICK_ENTRY_ROW_STATUS_INVALID) invalidCount += 1;
    else if (row.status === QUICK_ENTRY_ROW_STATUS_FAILED) failedCount += 1;
    else {
      throw new QuickEntrySubmissionError(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_INCOMPLETE,
        "submission 含未知 row status",
      );
    }
  }

  if (createdCount + duplicateCount + invalidCount + failedCount !== current.rowCount) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_INCOMPLETE,
      "submission summary 不一致",
    );
  }

  const updated = await database
    .update(schema.publicPoolQuickEntrySubmissions)
    .set({
      status: QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED,
      createdCount,
      duplicateCount,
      invalidCount,
      failedCount,
      completedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(schema.publicPoolQuickEntrySubmissions.actorUserId, input.actorUserId),
        eq(
          schema.publicPoolQuickEntrySubmissions.submissionId,
          input.submissionId,
        ),
        eq(
          schema.publicPoolQuickEntrySubmissions.status,
          QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING,
        ),
        eq(
          schema.publicPoolQuickEntrySubmissions.processingStartedAt,
          input.expectedProcessingStartedAt,
        ),
      ),
    )
    .returning();

  if (updated[0]) {
    return { submission: updated[0], rows };
  }

  const refreshed = await getSubmissionByActorAndClientId({
    actorUserId: input.actorUserId,
    submissionId: input.submissionId,
    db: database,
  });
  if (!refreshed || refreshed.status !== QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED) {
    throw new QuickEntrySubmissionError(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_LEASE_LOST,
      "submission 完成失败",
    );
  }
  const ordered = await listSubmissionRows({
    submissionDbId: refreshed.id,
    db: database,
  });
  return { submission: refreshed, rows: ordered };
}

export async function listSubmissionRowsForActor(input: {
  actorUserId: string;
  submissionId: string;
  db?: Database;
}): Promise<{
  submission: QuickEntrySubmissionRecord;
  rows: QuickEntrySubmissionRowRecord[];
} | null> {
  const submission = await getSubmissionByActorAndClientId(input);
  if (!submission) return null;
  const rows = await listSubmissionRows({
    submissionDbId: submission.id,
    db: input.db,
  });
  return { submission, rows };
}
