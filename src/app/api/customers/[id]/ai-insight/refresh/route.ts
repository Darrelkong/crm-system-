export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { PermissionError, assertCanViewCustomerAiInsight, resolveCustomerAccessOptions } from "@/lib/permissions/customers";
import { getDb } from "@/lib/db";
import { blockPendingOnHoldCreateCustomer } from "@/lib/customers/pending-on-hold-api";
import {
  buildCustomerAiInsightRefreshAuditMetadata,
  getCustomerAiInsightByCustomerId,
  getCustomerAiInsightDisplayMeta,
  refreshCustomerAiInsight,
} from "@/lib/ai/customer-insights/service";
import {
  AiAnalysisError,
  AiConfigError,
  AiRefreshCooldownError,
  AiRefreshDeniedError,
  AiStaffDailyLimitReachedError,
  AiStaffDeepAnalysisDisabledError,
  AiStaffReservationConflictError,
  AiDeepAnalysisGlobalDisabledError,
  AiDeepAnalysisMockOnlyError,
} from "@/lib/ai/customer-insights/errors";
import {
  getSafeAiRefreshErrorMessage,
  resolveAiRefreshErrorCode,
} from "@/lib/ai/customer-insights/error-mapping";
import { buildAiInsightRefreshFailedAuditMetadata } from "@/lib/ai/customer-insights/diagnostics";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getRequestMeta } from "@/lib/auth/cookies";
import { getEffectiveAiSettings } from "@/lib/settings/ai-effective";
import { getStaffAiUsageSummary } from "@/lib/ai/staff-usage/service";
import {
  isValidDeepInsight,
  resolveDeepAnalysisAvailability,
} from "@/lib/ai/deep-analysis/availability";
import { isAiApiKeyConfigured } from "@/lib/ai/env";
import { getBasicCustomerAnalysis } from "@/lib/ai/basic-analysis/service";
import { isAiRefreshOnCooldown } from "@/lib/ai/customer-insights/cooldown";

type RouteContext = { params: Promise<{ id: string }> };

function aiErrorStatus(error: unknown): number | null {
  if (error instanceof AiConfigError) return 503;
  if (error instanceof AiRefreshDeniedError) return 403;
  if (error instanceof AiStaffDeepAnalysisDisabledError) return 403;
  if (error instanceof AiDeepAnalysisGlobalDisabledError) return 403;
  if (error instanceof AiDeepAnalysisMockOnlyError) return 503;
  if (error instanceof AiStaffDailyLimitReachedError) return 429;
  if (error instanceof AiStaffReservationConflictError) return 409;
  if (error instanceof AiRefreshCooldownError) return 429;
  if (error instanceof AiAnalysisError) return 422;
  return null;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const db = getDb();
    const meta = getRequestMeta(request);

    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json({ error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" }, { status: 404 });
    }

    const pendingBlock = await blockPendingOnHoldCreateCustomer(db, id);
    if (pendingBlock) {
      return pendingBlock;
    }

    const accessOptions = await resolveCustomerAccessOptions(db, user, id);

    try {
      assertCanViewCustomerAiInsight(user, customer, accessOptions);
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: err.auditAction ?? "permission.denied.customer_ai_insight",
          userId: user.id,
          entityType: "customer",
          entityId: id,
        });
      }
      throw err;
    }

    let refreshResult;
    const aiSettings = await getEffectiveAiSettings(db);
    const reservationKey =
      request.headers.get("idempotency-key")?.trim() ||
      request.headers.get("x-idempotency-key")?.trim() ||
      undefined;
    try {
      refreshResult = await refreshCustomerAiInsight(
        db,
        user,
        customer,
        accessOptions,
        { reservationKey },
      );
    } catch (error) {
      const status = aiErrorStatus(error);
      if (status !== null) {
        const code = resolveAiRefreshErrorCode(error);
        if (!(error instanceof AiRefreshCooldownError)) {
          await writeAuditLog(
            {
              userId: user.id,
              action: "customer.ai_insight.refresh_failed",
              entityType: "customer",
              entityId: customer.id,
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
              metadata: buildAiInsightRefreshFailedAuditMetadata(
                customer.id,
                code,
                error,
              ),
            },
            db,
          );
        }
        const currentInsight = await getCustomerAiInsightByCustomerId(db, customer.id);
        const staffUsage =
          user.role === "staff"
            ? await getStaffAiUsageSummary(db, user, aiSettings)
            : null;
        const deepAnalysis = isValidDeepInsight(currentInsight)
          ? currentInsight
          : null;
        const deepAnalysisAvailability = resolveDeepAnalysisAvailability({
          user,
          settings: aiSettings,
          staffUsage,
          insight: currentInsight,
          providerConfigured: isAiApiKeyConfigured(),
          onCooldown: isAiRefreshOnCooldown(currentInsight),
        });
        let basicAnalysis = null;
        try {
          basicAnalysis = await getBasicCustomerAnalysis(db, customer);
        } catch {
          basicAnalysis = null;
        }
        const body = {
          error: getSafeAiRefreshErrorMessage(code),
          errorCode: code,
          insight: deepAnalysis,
          display: getCustomerAiInsightDisplayMeta(
            user,
            aiSettings,
            staffUsage,
            deepAnalysisAvailability,
          ),
          basicAnalysis,
          deepAnalysis,
          deepAnalysisAvailability,
        };
        return Response.json(body, { status });
      }
      throw error;
    }

    await writeAuditLog(
      {
        userId: user.id,
        action: "customer.ai_insight.refreshed",
        entityType: "customer",
        entityId: customer.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: buildCustomerAiInsightRefreshAuditMetadata(
          refreshResult.insight,
          refreshResult.providerKind,
        ),
      },
      db,
    );

    const aiSettingsAfter = await getEffectiveAiSettings(db);
    const staffUsageAfter =
      user.role === "staff"
        ? await getStaffAiUsageSummary(db, user, aiSettingsAfter)
        : null;
    const deepAnalysis = isValidDeepInsight(refreshResult.insight)
      ? refreshResult.insight
      : null;
    const deepAnalysisAvailability = resolveDeepAnalysisAvailability({
      user,
      settings: aiSettingsAfter,
      staffUsage: staffUsageAfter,
      insight: refreshResult.insight,
      providerConfigured: isAiApiKeyConfigured(),
      onCooldown: false,
    });
    let basicAnalysis = null;
    try {
      basicAnalysis = await getBasicCustomerAnalysis(db, customer);
    } catch {
      basicAnalysis = null;
    }
    return Response.json({
      insight: deepAnalysis,
      display: getCustomerAiInsightDisplayMeta(
        user,
        aiSettingsAfter,
        staffUsageAfter,
        deepAnalysisAvailability,
      ),
      basicAnalysis,
      deepAnalysis,
      deepAnalysisAvailability,
    });
  } catch (error) {
    const status = aiErrorStatus(error);
    if (status !== null) {
      const code = resolveAiRefreshErrorCode(error);
      return Response.json(
        {
          error: getSafeAiRefreshErrorMessage(code),
          errorCode: code,
        },
        { status },
      );
    }
    return authErrorResponse(error);
  }
}
