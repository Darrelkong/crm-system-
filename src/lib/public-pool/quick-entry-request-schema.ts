import type { QuickEntryBatchCustomerRowInput } from "@/lib/public-pool/quick-entry-batch-types";
import {
  QUICK_ENTRY_BATCH_MAX_ROWS,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES,
} from "@/lib/public-pool/quick-entry-submission-constants";
import {
  validateQuickEntryClientRowId,
  validateQuickEntrySubmissionId,
} from "@/lib/public-pool/quick-entry-submission-validation";

const TOP_LEVEL_ALLOWED = new Set(["submissionId", "rows"]);

const ROW_ALLOWED = new Set([
  "clientRowId",
  "customerName",
  "phone",
  "phoneCountryCode",
  "wechatId",
  "requestedProjectName",
  "initialFollowUpNote",
  "supplementalNote",
]);

/** Explicitly rejected system / injection field names (defense in depth). */
const FORBIDDEN_FIELDS = new Set([
  "submissionDbId",
  "submission_db_id",
  "internalSubmissionId",
  "requestHash",
  "expectedProcessingStartedAt",
  "actor",
  "actorId",
  "userId",
  "ownerId",
  "source",
  "status",
  "salesStage",
  "createdBy",
  "updatedBy",
  "poolEnteredAt",
  "customerCode",
  "sessionId",
  "grantVersion",
  "code",
  "passcode",
  "role",
  "email",
]);

export type ParsedQuickEntryBatchRequest = {
  submissionId: string;
  rows: QuickEntryBatchCustomerRowInput[];
};

export type QuickEntryRequestSchemaResult =
  | { ok: true; value: ParsedQuickEntryBatchRequest }
  | { ok: false; errorCode: string; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ownKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value);
}

function reject(
  errorCode: string,
  message: string,
): QuickEntryRequestSchemaResult {
  return { ok: false, errorCode, message };
}

/**
 * Strict allowlist parser for Quick Entry batch API body.
 * Does not validate customer business fields (those become row-level invalid).
 * Does not mutate the input object.
 */
export function parseQuickEntryBatchRequest(
  input: unknown,
): QuickEntryRequestSchemaResult {
  if (!isPlainObject(input)) {
    return reject(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
      "请求无效",
    );
  }

  const keys = ownKeys(input);
  for (const key of keys) {
    if (FORBIDDEN_FIELDS.has(key) || !TOP_LEVEL_ALLOWED.has(key)) {
      return reject(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
        "请求包含不允许的字段",
      );
    }
  }

  if (!("submissionId" in input) || !("rows" in input)) {
    return reject(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
      "请求无效",
    );
  }

  const submissionId = validateQuickEntrySubmissionId(input.submissionId);
  if (!submissionId.ok) {
    return reject(submissionId.errorCode, submissionId.message);
  }

  if (!Array.isArray(input.rows)) {
    return reject(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
      "rows 必须为数组",
    );
  }

  if (input.rows.length === 0) {
    return reject(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_EMPTY,
      "rows 不能为空",
    );
  }

  if (input.rows.length > QUICK_ENTRY_BATCH_MAX_ROWS) {
    return reject(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_TOO_LARGE,
      `rows 最多 ${QUICK_ENTRY_BATCH_MAX_ROWS} 行`,
    );
  }

  const seenClientRowIds = new Set<string>();
  const rows: QuickEntryBatchCustomerRowInput[] = [];

  for (let i = 0; i < input.rows.length; i += 1) {
    if (!(i in input.rows)) {
      return reject(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
        "rows 无效",
      );
    }
    const row = input.rows[i];
    if (!isPlainObject(row)) {
      return reject(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
        "row 必须为对象",
      );
    }

    for (const key of ownKeys(row)) {
      if (FORBIDDEN_FIELDS.has(key) || !ROW_ALLOWED.has(key)) {
        return reject(
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
          "请求包含不允许的字段",
        );
      }
    }

    if (!("clientRowId" in row) || !("customerName" in row) || !("requestedProjectName" in row)) {
      return reject(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
        "row 缺少必填字段",
      );
    }

    const clientRowId = validateQuickEntryClientRowId(row.clientRowId);
    if (!clientRowId.ok) {
      return reject(clientRowId.errorCode, clientRowId.message);
    }
    if (seenClientRowIds.has(clientRowId.value)) {
      return reject(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.CLIENT_ROW_ID_DUPLICATE,
        "clientRowId 重复",
      );
    }
    seenClientRowIds.add(clientRowId.value);

    if (typeof row.customerName !== "string") {
      return reject(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
        "customerName 无效",
      );
    }
    if (typeof row.requestedProjectName !== "string") {
      return reject(
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
        "requestedProjectName 无效",
      );
    }

    const parsed: QuickEntryBatchCustomerRowInput = {
      clientRowId: clientRowId.value,
      customerName: row.customerName,
      requestedProjectName: row.requestedProjectName,
    };

    if ("phone" in row) {
      if (row.phone != null && typeof row.phone !== "string") {
        return reject(
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
          "phone 无效",
        );
      }
      parsed.phone = row.phone as string | null;
    }
    if ("phoneCountryCode" in row) {
      if (
        row.phoneCountryCode != null &&
        typeof row.phoneCountryCode !== "string"
      ) {
        return reject(
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
          "phoneCountryCode 无效",
        );
      }
      parsed.phoneCountryCode = row.phoneCountryCode as string | null;
    }
    if ("wechatId" in row) {
      if (row.wechatId != null && typeof row.wechatId !== "string") {
        return reject(
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
          "wechatId 无效",
        );
      }
      parsed.wechatId = row.wechatId as string | null;
    }
    if ("initialFollowUpNote" in row) {
      if (
        row.initialFollowUpNote != null &&
        typeof row.initialFollowUpNote !== "string"
      ) {
        return reject(
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
          "initialFollowUpNote 无效",
        );
      }
      parsed.initialFollowUpNote = row.initialFollowUpNote as string | null;
    }
    if ("supplementalNote" in row) {
      if (
        row.supplementalNote != null &&
        typeof row.supplementalNote !== "string"
      ) {
        return reject(
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
          "supplementalNote 无效",
        );
      }
      parsed.supplementalNote = row.supplementalNote as string | null;
    }

    rows.push(parsed);
  }

  return {
    ok: true,
    value: {
      submissionId: submissionId.value,
      rows,
    },
  };
}
