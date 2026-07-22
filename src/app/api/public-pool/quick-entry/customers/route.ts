export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";
import {
  AuthError,
  authErrorResponse,
  requireAuthSession,
  type AuthSessionContext,
} from "@/lib/public-pool/quick-entry-auth";
import {
  processQuickEntryCustomerSubmission,
} from "@/lib/public-pool/quick-entry-batch-service";
import type {
  QuickEntryBatchCustomerRowInput,
  QuickEntryBatchResult,
} from "@/lib/public-pool/quick-entry-batch-types";
import { QUICK_ENTRY_MAX_BODY_BYTES } from "@/lib/public-pool/quick-entry-constants";
import { QUICK_ENTRY_SERVICE_ERROR_CODES } from "@/lib/public-pool/quick-entry-customer-service";
import { parseQuickEntryBatchRequest } from "@/lib/public-pool/quick-entry-request-schema";
import {
  QuickEntrySecurityError,
  requireActiveQuickEntryGrant,
} from "@/lib/public-pool/quick-entry-security";
import { QUICK_ENTRY_SUBMISSION_ERROR_CODES } from "@/lib/public-pool/quick-entry-submission-constants";
import { QuickEntrySubmissionError } from "@/lib/public-pool/quick-entry-submission-repository";
import type { User } from "../../../../../../drizzle/schema/users";

const BATCH_AUDIT_COMPLETED = "public_pool.quick_entry.batch_completed";
const BATCH_AUDIT_REPLAYED = "public_pool.quick_entry.batch_replayed";

const CONFLICT_CODES = new Set<string>([
  QUICK_ENTRY_SUBMISSION_ERROR_CODES.IDEMPOTENCY_CONFLICT,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_PROCESSING,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_LEASE_LOST,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ALREADY_COMPLETED,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ROW_CONFLICT,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_INCOMPLETE,
]);

const BAD_REQUEST_CODES = new Set<string>([
  QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_EMPTY,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_TOO_LARGE,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ID_INVALID,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES.CLIENT_ROW_ID_INVALID,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES.CLIENT_ROW_ID_DUPLICATE,
]);

export type QuickEntryBatchRouteDeps = {
  requireAuthSession: () => Promise<AuthSessionContext>;
  requireActiveQuickEntryGrant: (sessionId: string) => Promise<{
    grantExpiresAt: string;
    grantVersion: number;
  }>;
  getRequestMeta: (request: Request) => {
    ipAddress?: string | null;
    userAgent?: string | null;
  };
  processQuickEntryCustomerSubmission: (input: {
    actor: User;
    submissionId: string;
    rows: QuickEntryBatchCustomerRowInput[];
  }) => Promise<QuickEntryBatchResult>;
  writeAuditLog: typeof writeAuditLog;
  maxBodyBytes: number;
};

const defaultDeps: QuickEntryBatchRouteDeps = {
  requireAuthSession,
  requireActiveQuickEntryGrant,
  getRequestMeta,
  processQuickEntryCustomerSubmission,
  writeAuditLog,
  maxBodyBytes: QUICK_ENTRY_MAX_BODY_BYTES,
};

function assertBatchActor(user: User): void {
  if (user.deletedAt != null) {
    throw new AuthError(403, "账号已删除");
  }
  if (user.isActive !== 1) {
    throw new AuthError(403, "账号已禁用");
  }
  if (user.role !== "admin" && user.role !== "staff") {
    throw new AuthError(403, "权限不足");
  }
}

function jsonError(
  status: number,
  errorCode: string,
  error: string,
  extra?: Record<string, unknown>,
): Response {
  const headers = new Headers();
  if (
    status === 429 &&
    typeof extra?.retryAfterSeconds === "number" &&
    Number.isFinite(extra.retryAfterSeconds)
  ) {
    headers.set("Retry-After", String(extra.retryAfterSeconds));
  }
  if (
    status === 409 &&
    typeof extra?.retryAfterSeconds === "number" &&
    Number.isFinite(extra.retryAfterSeconds)
  ) {
    headers.set("Retry-After", String(extra.retryAfterSeconds));
  }
  return Response.json(
    {
      ok: false,
      error,
      errorCode,
      ...extra,
    },
    { status, headers },
  );
}

function mapDomainFailure(result: Extract<QuickEntryBatchResult, { ok: false }>): Response {
  const code = result.errorCode;
  if (code === QUICK_ENTRY_SERVICE_ERROR_CODES.ACTOR_INVALID) {
    return jsonError(403, code, result.message);
  }
  if (BAD_REQUEST_CODES.has(code)) {
    return jsonError(400, code, result.message);
  }
  if (CONFLICT_CODES.has(code)) {
    const extra: Record<string, unknown> = {};
    if (
      code === QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_PROCESSING &&
      result.retryAfterSeconds != null
    ) {
      extra.retryAfterSeconds = Math.max(1, Math.floor(result.retryAfterSeconds));
    }
    return jsonError(409, code, result.message, extra);
  }
  return jsonError(500, "SERVER_ERROR", "服务器错误");
}

async function writeBatchAuditBestEffort(
  deps: QuickEntryBatchRouteDeps,
  input: {
    user: User;
    submissionId: string;
    replayed: boolean;
    summary: {
      total: number;
      created: number;
      duplicates: number;
      invalid: number;
      failed: number;
    };
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  try {
    await deps.writeAuditLog({
      userId: input.user.id,
      action: input.replayed ? BATCH_AUDIT_REPLAYED : BATCH_AUDIT_COMPLETED,
      entityType: "public_pool_quick_entry_submission",
      entityId: input.submissionId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: {
        submissionId: input.submissionId,
        total: input.summary.total,
        created: input.summary.created,
        duplicates: input.summary.duplicates,
        invalid: input.summary.invalid,
        failed: input.summary.failed,
        replayed: input.replayed,
        actorRole: input.user.role,
      },
    });
  } catch {
    // Best-effort: never fail the completed batch response.
  }
}

export async function handleQuickEntryBatchCustomersPost(
  request: Request,
  deps: QuickEntryBatchRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { user, sessionId } = await deps.requireAuthSession();
    assertBatchActor(user);
    await deps.requireActiveQuickEntryGrant(sessionId);

    const bodyResult = await readLimitedJsonBody(request, deps.maxBodyBytes);
    if (!bodyResult.ok) {
      return jsonError(
        bodyResult.httpStatus,
        bodyResult.errorCode,
        bodyResult.message,
      );
    }

    const parsed = parseQuickEntryBatchRequest(bodyResult.value);
    if (!parsed.ok) {
      return jsonError(400, parsed.errorCode, parsed.message);
    }

    const { ipAddress, userAgent } = deps.getRequestMeta(request);

    let domainResult: QuickEntryBatchResult;
    try {
      domainResult = await deps.processQuickEntryCustomerSubmission({
        actor: user,
        submissionId: parsed.value.submissionId,
        rows: parsed.value.rows,
      });
    } catch (error) {
      if (error instanceof QuickEntrySubmissionError) {
        return mapDomainFailure({
          ok: false,
          errorCode: error.errorCode,
          message: error.message,
          retryAfterSeconds: error.retryAfterSeconds ?? undefined,
        });
      }
      return jsonError(500, "SERVER_ERROR", "服务器错误");
    }

    if (!domainResult.ok) {
      return mapDomainFailure(domainResult);
    }

    await writeBatchAuditBestEffort(deps, {
      user,
      submissionId: domainResult.submissionId,
      replayed: domainResult.replayed,
      summary: domainResult.summary,
      ipAddress,
      userAgent,
    });

    return Response.json({
      ok: true,
      submissionId: domainResult.submissionId,
      replayed: domainResult.replayed,
      summary: domainResult.summary,
      results: domainResult.results,
    });
  } catch (error) {
    if (error instanceof QuickEntrySecurityError) {
      return jsonError(error.httpStatus, error.errorCode, error.message, {
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  return handleQuickEntryBatchCustomersPost(request);
}
