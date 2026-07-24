export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import {
  PermissionError,
  assertCanAddFollowUp,
  resolveCustomerAccessOptions,
} from "@/lib/permissions/customers";
import { getDb } from "@/lib/db";
import { blockPendingOnHoldCreateCustomer } from "@/lib/customers/pending-on-hold-api";
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
  AiStaffFollowUpOrganizationDisabledError,
  AiStaffReservationConflictError,
  AiRefreshDeniedError,
} from "@/lib/ai/customer-insights/errors";
import {
  getSafeAiRefreshErrorMessage,
  resolveAiRefreshErrorCode,
  mapAiAnalysisErrorCode,
} from "@/lib/ai/customer-insights/error-mapping";
import type { User } from "../../../../../../../drizzle/schema/users";
import type { Customer } from "../../../../../../../drizzle/schema/customers";
import type { Database } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

function organizeErrorStatus(error: unknown): number | null {
  if (error instanceof FollowUpOrganizeValidationError) return 400;
  if (error instanceof FollowUpOrganizeFactError) return 422;
  if (error instanceof AiDeepAnalysisGlobalDisabledError) return 403;
  if (error instanceof AiDeepAnalysisMockOnlyError) return 503;
  if (error instanceof AiStaffDeepAnalysisDisabledError) return 403;
  if (error instanceof AiStaffFollowUpOrganizationDisabledError) return 403;
  if (error instanceof AiStaffDailyLimitReachedError) return 429;
  if (error instanceof AiStaffReservationConflictError) return 409;
  if (error instanceof AiRefreshDeniedError) return 403;
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

async function assertOrganizePermission(
  request: Request,
  db: Database,
  user: User,
  id: string,
  customer: Customer,
) {
  const accessOptions = await resolveCustomerAccessOptions(db, user, id);
  try {
    assertCanAddFollowUp(user, customer, accessOptions);
  } catch (err) {
    if (err instanceof PermissionError) {
      await logPermissionDenied(request, {
        action: err.auditAction ?? "permission.denied.follow_up_create",
        userId: user.id,
        entityType: "customer",
        entityId: id,
      });
    }
    throw err;
  }
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const db = getDb();
    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json(
        { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
        { status: 404 },
      );
    }
    await assertOrganizePermission(request, db, user, id, customer);
    const availability = await getFollowUpOrganizeAvailability(db, user);
    return Response.json({ availability });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const db = getDb();

    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json(
        { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
        { status: 404 },
      );
    }

    const pendingBlock = await blockPendingOnHoldCreateCustomer(db, id);
    if (pendingBlock) return pendingBlock;

    await assertOrganizePermission(request, db, user, id, customer);

    const body = (await request.json()) as Record<string, unknown>;

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
        customer,
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
