export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import {
  FollowUpOrganizeFactError,
  FollowUpOrganizeValidationError,
  getFollowUpOrganizeAvailability,
  organizeFollowUpForUser,
} from "@/lib/ai/follow-up-organize/service";
import { hasFollowUpOrganizeClientOverride } from "@/lib/ai/follow-up-organize/response-safety";
import {
  AiConfigError,
  AiDeepAnalysisGlobalDisabledError,
  AiDeepAnalysisMockOnlyError,
  AiProviderError,
  AiStaffDailyLimitReachedError,
  AiStaffDeepAnalysisDisabledError,
  AiStaffReservationConflictError,
} from "@/lib/ai/customer-insights/errors";
import {
  getSafeAiRefreshErrorMessage,
  mapAiAnalysisErrorCode,
  resolveAiRefreshErrorCode,
} from "@/lib/ai/customer-insights/error-mapping";

/**
 * Draft organize for customer-create notes (no customer id yet).
 * Requires auth only; does not read customer rows.
 */
function organizeErrorStatus(error: unknown): number | null {
  if (error instanceof FollowUpOrganizeValidationError) return 400;
  if (error instanceof FollowUpOrganizeFactError) return 422;
  if (error instanceof AiDeepAnalysisGlobalDisabledError) return 403;
  if (error instanceof AiDeepAnalysisMockOnlyError) return 503;
  if (error instanceof AiStaffDeepAnalysisDisabledError) return 403;
  if (error instanceof AiStaffDailyLimitReachedError) return 429;
  if (error instanceof AiStaffReservationConflictError) return 409;
  if (error instanceof AiConfigError) return 503;
  if (error instanceof AiProviderError) return 503;
  return null;
}

function organizeErrorCode(error: unknown): string {
  if (error instanceof FollowUpOrganizeValidationError) return error.code;
  if (error instanceof FollowUpOrganizeFactError) return error.code;
  if (error instanceof AiProviderError) {
    return mapAiAnalysisErrorCode(error.diagnostics);
  }
  return resolveAiRefreshErrorCode(error);
}

function organizeErrorMessage(code: string): string {
  switch (code) {
    case "INPUT_EMPTY":
      return "請輸入跟進文字。";
    case "INPUT_TOO_SHORT":
      return "跟進文字過短，請補充後再整理。";
    case "INPUT_TOO_LONG":
      return "跟進文字過長。";
    case "INVALID_MODE":
      return "無效的整理模式。";
    case "POSSIBLE_FACT_ADDED":
      return "整理結果疑似新增原文沒有的事實，已保留原文。";
    default:
      return getSafeAiRefreshErrorMessage(
        code as Parameters<typeof getSafeAiRefreshErrorMessage>[0],
      );
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const db = getDb();
    const availability = await getFollowUpOrganizeAvailability(db, user);
    return Response.json({ availability });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth(request);
    const db = getDb();
    const body = (await request.json()) as Record<string, unknown>;

    // Reject client-supplied customerId on this draft endpoint to avoid
    // bypassing customer follow-up permission checks.
    if (body.customerId !== undefined && body.customerId !== null) {
      return Response.json(
        {
          error: "請使用客戶跟進整理接口",
          errorCode: "CUSTOMER_ID_NOT_ALLOWED",
        },
        { status: 400 },
      );
    }

    if (hasFollowUpOrganizeClientOverride(body)) {
      return Response.json(
        {
          error: "不接受客戶端覆寫參數",
          errorCode: "CLIENT_OVERRIDE_REJECTED",
        },
        { status: 400 },
      );
    }

    const reservationKey =
      request.headers.get("Idempotency-Key")?.trim() ||
      request.headers.get("x-idempotency-key")?.trim() ||
      undefined;

    try {
      const result = await organizeFollowUpForUser(db, user, {
        mode: body.mode,
        text: body.text,
        reservationKey,
        customer: null,
      });
      const availability = await getFollowUpOrganizeAvailability(db, user);
      return Response.json({ result, availability });
    } catch (error) {
      const status = organizeErrorStatus(error);
      if (status !== null) {
        const code = organizeErrorCode(error);
        const availability = await getFollowUpOrganizeAvailability(db, user);
        return Response.json(
          {
            error: organizeErrorMessage(code),
            errorCode: code,
            availability,
          },
          { status },
        );
      }
      throw error;
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}
