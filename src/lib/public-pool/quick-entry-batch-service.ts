import type { Database } from "@/lib/db";
import { getDb } from "@/lib/db";
import { userMustChangePassword } from "@/lib/auth/change-password";
import { classifyQuickEntryBatchRows } from "@/lib/public-pool/quick-entry-batch-classification";
import type {
  QuickEntryBatchCanonicalRow,
  QuickEntryBatchCustomerRowInput,
  QuickEntryBatchFailure,
  QuickEntryBatchResult,
  QuickEntryBatchRowResult,
  QuickEntryBatchSummary,
} from "@/lib/public-pool/quick-entry-batch-types";
import {
  prepareDirectPublicPoolCustomerCreation,
  QUICK_ENTRY_SERVICE_ERROR_CODES,
} from "@/lib/public-pool/quick-entry-customer-service";
import {
  normalizeQuickEntryCustomerInput,
  validateQuickEntryCustomerInput,
} from "@/lib/public-pool/quick-entry-customer-validation";
import {
  QUICK_ENTRY_BATCH_MAX_ROWS,
  QUICK_ENTRY_ROW_STATUS_CREATED,
  QUICK_ENTRY_ROW_STATUS_DUPLICATE,
  QUICK_ENTRY_ROW_STATUS_INVALID,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES,
  QUICK_ENTRY_SUBMISSION_LEASE_HEARTBEAT_SECONDS,
} from "@/lib/public-pool/quick-entry-submission-constants";
import { hashQuickEntrySubmissionPayload } from "@/lib/public-pool/quick-entry-submission-hash";
import {
  buildInsertQuickEntrySubmissionRowForLeaseStatement,
  completeQuickEntrySubmissionForLease,
  createOrLoadSubmission,
  listSubmissionRowsForActor,
  QuickEntrySubmissionError,
  renewQuickEntrySubmissionLease,
  type QuickEntrySubmissionRowRecord,
} from "@/lib/public-pool/quick-entry-submission-repository";
import {
  validateQuickEntryClientRowId,
  validateQuickEntrySubmissionId,
} from "@/lib/public-pool/quick-entry-submission-validation";
import type { User } from "../../../drizzle/schema/users";

function assertActiveActor(actor: User): QuickEntryBatchResult | null {
  if (
    !actor ||
    actor.isActive !== 1 ||
    actor.deletedAt != null ||
    userMustChangePassword(actor) ||
    (actor.role !== "admin" && actor.role !== "staff")
  ) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SERVICE_ERROR_CODES.ACTOR_INVALID,
      message: "操作者无效",
    };
  }
  return null;
}

function mapExistingRowToResult(
  row: QuickEntrySubmissionRowRecord,
): QuickEntryBatchRowResult {
  if (row.status === QUICK_ENTRY_ROW_STATUS_CREATED) {
    return {
      clientRowId: row.clientRowId,
      status: "created",
      customerId: row.customerId!,
      customerCode: row.customerCode!,
      customerName: row.customerName!,
    };
  }
  if (row.status === QUICK_ENTRY_ROW_STATUS_DUPLICATE) {
    return {
      clientRowId: row.clientRowId,
      status: "duplicate",
      errorCode: row.errorCode!,
      duplicateField: row.duplicateField!,
    };
  }
  if (row.status === QUICK_ENTRY_ROW_STATUS_INVALID) {
    return {
      clientRowId: row.clientRowId,
      status: "invalid",
      errorCode: row.errorCode!,
    };
  }
  return {
    clientRowId: row.clientRowId,
    status: "failed",
    errorCode: row.errorCode ?? QUICK_ENTRY_SUBMISSION_ERROR_CODES.CUSTOMER_CREATE_FAILED,
  };
}

function summaryFromResults(results: QuickEntryBatchRowResult[]): QuickEntryBatchSummary {
  const summary: QuickEntryBatchSummary = {
    total: results.length,
    created: 0,
    duplicates: 0,
    invalid: 0,
    failed: 0,
  };
  for (const row of results) {
    if (row.status === "created") summary.created += 1;
    else if (row.status === "duplicate") summary.duplicates += 1;
    else if (row.status === "invalid") summary.invalid += 1;
    else summary.failed += 1;
  }
  return summary;
}

function buildCanonicalRows(
  submissionId: string,
  rows: QuickEntryBatchCustomerRowInput[],
):
  | { ok: true; canonical: QuickEntryBatchCanonicalRow[] }
  | { ok: false; errorCode: string; message: string } {
  if (!Array.isArray(rows)) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
      message: "rows 无效",
    };
  }
  if (rows.length === 0) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_EMPTY,
      message: "rows 不能为空",
    };
  }
  if (rows.length > QUICK_ENTRY_BATCH_MAX_ROWS) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_TOO_LARGE,
      message: `rows 最多 ${QUICK_ENTRY_BATCH_MAX_ROWS} 行`,
    };
  }

  const seen = new Set<string>();
  const canonical: QuickEntryBatchCanonicalRow[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return {
        ok: false,
        errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
        message: "row 无效",
      };
    }
    const clientRowId = validateQuickEntryClientRowId(row.clientRowId);
    if (!clientRowId.ok) {
      return {
        ok: false,
        errorCode: clientRowId.errorCode,
        message: clientRowId.message,
      };
    }
    if (seen.has(clientRowId.value)) {
      return {
        ok: false,
        errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.CLIENT_ROW_ID_DUPLICATE,
        message: "clientRowId 重复",
      };
    }
    seen.add(clientRowId.value);

    const normalized = normalizeQuickEntryCustomerInput({
      customerName: row.customerName,
      phone: row.phone,
      phoneCountryCode: row.phoneCountryCode,
      wechatId: row.wechatId,
      requestedProjectName: row.requestedProjectName,
      initialFollowUpNote: row.initialFollowUpNote,
      supplementalNote: row.supplementalNote,
    });

    canonical.push({
      clientRowId: clientRowId.value,
      ...normalized,
    });
  }

  void submissionId;
  return { ok: true, canonical };
}

async function maybeRenewLease(input: {
  actorUserId: string;
  submissionId: string;
  leaseToken: string;
  now: Date;
  db: Database;
}): Promise<string> {
  const started = Date.parse(input.leaseToken);
  if (
    !Number.isNaN(started) &&
    input.now.getTime() - started >=
      QUICK_ENTRY_SUBMISSION_LEASE_HEARTBEAT_SECONDS * 1000
  ) {
    const renewed = await renewQuickEntrySubmissionLease({
      actorUserId: input.actorUserId,
      submissionId: input.submissionId,
      expectedProcessingStartedAt: input.leaseToken,
      now: input.now,
      db: input.db,
    });
    return renewed.processingStartedAt;
  }
  return input.leaseToken;
}

function mapSubmissionError(err: unknown): QuickEntryBatchFailure {
  if (err instanceof QuickEntrySubmissionError) {
    return {
      ok: false,
      errorCode: err.errorCode,
      message: err.message,
      retryAfterSeconds: err.retryAfterSeconds ?? undefined,
    };
  }
  throw err;
}

/**
 * Processes a quick-entry customer batch submission (domain only — no HTTP).
 * Grant checks belong to 3C Route.
 */
export async function processQuickEntryCustomerSubmission(input: {
  actor: User;
  submissionId: string;
  rows: QuickEntryBatchCustomerRowInput[];
  now?: Date;
  db?: Database;
}): Promise<QuickEntryBatchResult> {
  const actorFailure = assertActiveActor(input.actor);
  if (actorFailure) return actorFailure;

  const submissionId = validateQuickEntrySubmissionId(input.submissionId);
  if (!submissionId.ok) {
    return {
      ok: false,
      errorCode: submissionId.errorCode,
      message: submissionId.message,
    };
  }

  const built = buildCanonicalRows(submissionId.value, input.rows);
  if (!built.ok) {
    return {
      ok: false,
      errorCode: built.errorCode,
      message: built.message,
    };
  }

  const database = input.db ?? getDb();
  let now = input.now ?? new Date();

  const requestHash = await hashQuickEntrySubmissionPayload({
    submissionId: submissionId.value,
    rows: built.canonical,
  });

  let load;
  try {
    load = await createOrLoadSubmission({
      actorUserId: input.actor.id,
      submissionId: submissionId.value,
      requestHash,
      rowCount: built.canonical.length,
      now,
      db: database,
    });
  } catch (err) {
    return mapSubmissionError(err);
  }

  if (load.state === "completed") {
    const results = load.rows.map(mapExistingRowToResult);
    return {
      ok: true,
      submissionId: submissionId.value,
      replayed: true,
      summary: summaryFromResults(results),
      results,
    };
  }

  if (load.state === "processing") {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_PROCESSING,
      message: "submission 处理中",
      retryAfterSeconds: load.retryAfterSeconds,
    };
  }

  let leaseToken = load.submission.processingStartedAt;
  const existingRows =
    load.state === "reclaimed" ? load.existingRows : ([] as QuickEntrySubmissionRowRecord[]);

  const validationInputs = built.canonical.map((row, rowIndex) => {
    const validation = validateQuickEntryCustomerInput({
      customerName: row.customerName,
      phone: row.phone,
      phoneCountryCode: row.phoneCountryCode,
      wechatId: row.wechatId,
      requestedProjectName: row.requestedProjectName,
      initialFollowUpNote: row.initialFollowUpNote,
      supplementalNote: row.supplementalNote,
    });
    return {
      rowIndex,
      clientRowId: row.clientRowId,
      canonical: {
        customerName: row.customerName,
        phone: row.phone,
        phoneCountryCode: row.phoneCountryCode,
        wechatId: row.wechatId,
        requestedProjectName: row.requestedProjectName,
        initialFollowUpNote: row.initialFollowUpNote,
        supplementalNote: row.supplementalNote,
      },
      validation,
    };
  });

  const classified = classifyQuickEntryBatchRows(validationInputs);
  const classifiedByIndex = new Map(
    classified.map((row) => [row.rowIndex, row] as const),
  );

  const existingByIndex = new Map<number, QuickEntrySubmissionRowRecord>();
  for (const row of existingRows) {
    if (existingByIndex.has(row.rowIndex)) {
      return {
        ok: false,
        errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ROW_CONFLICT,
        message: "existing rowIndex 重复",
      };
    }
    if (row.rowIndex < 0 || row.rowIndex >= built.canonical.length) {
      return {
        ok: false,
        errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ROW_CONFLICT,
        message: "existing rowIndex 超出范围",
      };
    }
    const expected = built.canonical[row.rowIndex]!;
    if (row.clientRowId !== expected.clientRowId) {
      return {
        ok: false,
        errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ROW_CONFLICT,
        message: "existing clientRowId 冲突",
      };
    }
    existingByIndex.set(row.rowIndex, row);
  }

  const resultsByIndex = new Map<number, QuickEntryBatchRowResult>();

  for (let rowIndex = 0; rowIndex < built.canonical.length; rowIndex += 1) {
    now = input.now ?? new Date();
    try {
      leaseToken = await maybeRenewLease({
        actorUserId: input.actor.id,
        submissionId: submissionId.value,
        leaseToken,
        now,
        db: database,
      });
    } catch (err) {
      return mapSubmissionError(err);
    }

    const existing = existingByIndex.get(rowIndex);
    if (existing) {
      resultsByIndex.set(rowIndex, mapExistingRowToResult(existing));
      continue;
    }

    const plan = classifiedByIndex.get(rowIndex);
    if (!plan) {
      return {
        ok: false,
        errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
        message: "分类结果缺失",
      };
    }

    try {
      if (plan.kind === "invalid") {
        await database.batch([
          buildInsertQuickEntrySubmissionRowForLeaseStatement(database, {
            actorUserId: input.actor.id,
            submissionId: submissionId.value,
            expectedProcessingStartedAt: leaseToken,
            clientRowId: plan.clientRowId,
            rowIndex,
            status: QUICK_ENTRY_ROW_STATUS_INVALID,
            errorCode: plan.errorCode,
            now,
          }),
        ] as unknown as Parameters<Database["batch"]>[0]);
        resultsByIndex.set(rowIndex, {
          clientRowId: plan.clientRowId,
          status: "invalid",
          errorCode: plan.errorCode,
        });
        continue;
      }

      if (plan.kind === "duplicate") {
        await database.batch([
          buildInsertQuickEntrySubmissionRowForLeaseStatement(database, {
            actorUserId: input.actor.id,
            submissionId: submissionId.value,
            expectedProcessingStartedAt: leaseToken,
            clientRowId: plan.clientRowId,
            rowIndex,
            status: QUICK_ENTRY_ROW_STATUS_DUPLICATE,
            errorCode: plan.errorCode,
            duplicateField: plan.duplicateField,
            now,
          }),
        ] as unknown as Parameters<Database["batch"]>[0]);
        resultsByIndex.set(rowIndex, {
          clientRowId: plan.clientRowId,
          status: "duplicate",
          errorCode: plan.errorCode,
          duplicateField: plan.duplicateField,
        });
        continue;
      }

      const prepared = await prepareDirectPublicPoolCustomerCreation({
        actor: input.actor,
        customer: {
          customerName: plan.normalizedCustomer.customerName,
          phone: plan.normalizedCustomer.phone,
          phoneCountryCode: plan.normalizedCustomer.phoneCountryCode,
          wechatId: plan.normalizedCustomer.wechatId,
          requestedProjectName: plan.normalizedCustomer.requestedProjectName,
          initialFollowUpNote: plan.normalizedCustomer.initialFollowUpNote,
          supplementalNote: plan.normalizedCustomer.supplementalNote,
        },
        db: database,
        now,
      });

      if (prepared.kind === "invalid") {
        await database.batch([
          buildInsertQuickEntrySubmissionRowForLeaseStatement(database, {
            actorUserId: input.actor.id,
            submissionId: submissionId.value,
            expectedProcessingStartedAt: leaseToken,
            clientRowId: plan.clientRowId,
            rowIndex,
            status: QUICK_ENTRY_ROW_STATUS_INVALID,
            errorCode: prepared.errorCode,
            now,
          }),
        ] as unknown as Parameters<Database["batch"]>[0]);
        resultsByIndex.set(rowIndex, {
          clientRowId: plan.clientRowId,
          status: "invalid",
          errorCode: prepared.errorCode,
        });
        continue;
      }

      if (prepared.kind === "duplicate") {
        const duplicateField =
          prepared.duplicateField === "wechatId" ? "wechatId" : "phone";
        await database.batch([
          buildInsertQuickEntrySubmissionRowForLeaseStatement(database, {
            actorUserId: input.actor.id,
            submissionId: submissionId.value,
            expectedProcessingStartedAt: leaseToken,
            clientRowId: plan.clientRowId,
            rowIndex,
            status: QUICK_ENTRY_ROW_STATUS_DUPLICATE,
            errorCode: prepared.errorCode,
            duplicateField,
            now,
          }),
        ] as unknown as Parameters<Database["batch"]>[0]);
        resultsByIndex.set(rowIndex, {
          clientRowId: plan.clientRowId,
          status: "duplicate",
          errorCode: prepared.errorCode,
          duplicateField,
        });
        continue;
      }

      const rowStmt = buildInsertQuickEntrySubmissionRowForLeaseStatement(
        database,
        {
          actorUserId: input.actor.id,
          submissionId: submissionId.value,
          expectedProcessingStartedAt: leaseToken,
          clientRowId: plan.clientRowId,
          rowIndex,
          status: QUICK_ENTRY_ROW_STATUS_CREATED,
          customerId: prepared.customerId,
          customerCode: prepared.customerCode,
          customerName: prepared.customerName,
          now,
        },
      );

      await database.batch([
        ...prepared.statements,
        rowStmt,
      ] as unknown as Parameters<Database["batch"]>[0]);

      resultsByIndex.set(rowIndex, {
        clientRowId: plan.clientRowId,
        status: "created",
        customerId: prepared.customerId,
        customerCode: prepared.customerCode,
        customerName: prepared.customerName,
      });
    } catch (err) {
      if (err instanceof QuickEntrySubmissionError) {
        return mapSubmissionError(err);
      }
      // System / infrastructure — abort without writing failed terminal row.
      throw err;
    }
  }

  try {
    now = input.now ?? new Date();
    leaseToken = await maybeRenewLease({
      actorUserId: input.actor.id,
      submissionId: submissionId.value,
      leaseToken,
      now,
      db: database,
    });
    await completeQuickEntrySubmissionForLease({
      actorUserId: input.actor.id,
      submissionId: submissionId.value,
      expectedProcessingStartedAt: leaseToken,
      now,
      db: database,
    });
  } catch (err) {
    return mapSubmissionError(err);
  }

  const results: QuickEntryBatchRowResult[] = [];
  for (let i = 0; i < built.canonical.length; i += 1) {
    const result = resultsByIndex.get(i);
    if (!result) {
      return {
        ok: false,
        errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_INCOMPLETE,
        message: "results 不完整",
      };
    }
    results.push(result);
  }

  // Prefer completed summary from DB when available.
  const final = await listSubmissionRowsForActor({
    actorUserId: input.actor.id,
    submissionId: submissionId.value,
    db: database,
  });
  const summary = final
    ? {
        total: final.submission.rowCount,
        created: final.submission.createdCount,
        duplicates: final.submission.duplicateCount,
        invalid: final.submission.invalidCount,
        failed: final.submission.failedCount,
      }
    : summaryFromResults(results);

  return {
    ok: true,
    submissionId: submissionId.value,
    replayed: false,
    summary,
    results,
  };
}
