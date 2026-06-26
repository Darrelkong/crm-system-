export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { PermissionError, assertCanViewCustomerAiInsight } from "@/lib/permissions/customers";
import { getDb } from "@/lib/db";
import {
  buildCustomerAiInsightRefreshAuditMetadata,
  getCustomerAiInsightByCustomerId,
  getCustomerAiInsightDisplayMeta,
  refreshCustomerAiInsight,
} from "@/lib/ai/customer-insights/service";
import {
  AiAnalysisError,
  AiConfigError,
  AiRefreshDeniedError,
} from "@/lib/ai/customer-insights/errors";
import { buildAiInsightRefreshFailedAuditMetadata } from "@/lib/ai/customer-insights/diagnostics";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getRequestMeta } from "@/lib/auth/cookies";
import { getEffectiveAiSettings } from "@/lib/settings/ai-effective";

type RouteContext = { params: Promise<{ id: string }> };

function aiErrorStatus(error: unknown): number | null {
  if (error instanceof AiConfigError) return 503;
  if (error instanceof AiRefreshDeniedError) return 403;
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

    try {
      assertCanViewCustomerAiInsight(user, customer);
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
    try {
      refreshResult = await refreshCustomerAiInsight(db, user, customer);
    } catch (error) {
      const status = aiErrorStatus(error);
      if (status !== null) {
        const code =
          error instanceof AiConfigError
            ? error.code
            : error instanceof AiAnalysisError
              ? error.code
              : error instanceof AiRefreshDeniedError
                ? error.code
                : "AI_PROVIDER_ERROR";
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
        const currentInsight = await getCustomerAiInsightByCustomerId(db, customer.id);
        const body = {
          error:
            error instanceof AiConfigError
              ? error.message
              : error instanceof AiAnalysisError
                ? error.message
                : error instanceof AiRefreshDeniedError
                  ? error.message
                  : "AI 分析失败，请稍后重试",
          errorCode: code,
          insight: currentInsight,
          display: getCustomerAiInsightDisplayMeta(user, aiSettings),
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
    return Response.json({
      insight: refreshResult.insight,
      display: getCustomerAiInsightDisplayMeta(user, aiSettingsAfter),
    });
  } catch (error) {
    const status = aiErrorStatus(error);
    if (status !== null) {
      const code =
        error instanceof AiConfigError
          ? error.code
          : error instanceof AiAnalysisError
            ? error.code
            : error instanceof AiRefreshDeniedError
              ? error.code
              : "AI_PROVIDER_ERROR";
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "AI 分析失败，请稍后重试",
          errorCode: code,
        },
        { status },
      );
    }
    return authErrorResponse(error);
  }
}
