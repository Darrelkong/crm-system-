export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { PermissionError } from "@/lib/permissions/customers";
import { getDb } from "@/lib/db";
import { getRequestMeta } from "@/lib/auth/cookies";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { blockPendingOnHoldCreateCustomer } from "@/lib/customers/pending-on-hold-api";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";
import {
  ComponentFeedbackApiError,
  getComponentFeedbackForActor,
  putComponentFeedbackForActor,
  toComponentFeedbackApiErrorResponse,
} from "@/lib/ai/customer-insights/feedback-component-api";
import {
  AI_FEEDBACK_COMPONENT_MAX_BODY_BYTES,
  parseComponentFeedbackPutBody,
} from "@/lib/ai/customer-insights/feedback-component-request";
import {
  AI_FEEDBACK_COMPONENT_AUDIT_CREATED,
  AI_FEEDBACK_COMPONENT_AUDIT_UPDATED,
  buildComponentFeedbackAuditMetadata,
} from "@/lib/ai/customer-insights/feedback-component-audit";

type RouteContext = { params: Promise<{ id: string }> };

function mapBodyReadError(errorCode: string, httpStatus: number, message: string) {
  if (httpStatus === 413 || errorCode.includes("TOO_LARGE")) {
    return new ComponentFeedbackApiError(
      413,
      "请求体过大",
      "AI_FEEDBACK_BODY_TOO_LARGE",
    );
  }
  return new ComponentFeedbackApiError(
    httpStatus === 415 ? 415 : 400,
    message || "请求格式无效",
    "AI_FEEDBACK_INVALID_REQUEST",
  );
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const db = getDb();

    const pendingBlock = await blockPendingOnHoldCreateCustomer(db, id);
    if (pendingBlock) {
      return pendingBlock;
    }

    try {
      const result = await getComponentFeedbackForActor(db, user, id);
      return Response.json(result);
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
  } catch (error) {
    if (error instanceof ComponentFeedbackApiError) {
      return toComponentFeedbackApiErrorResponse(error);
    }
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const db = getDb();
    const meta = getRequestMeta(request);

    const pendingBlock = await blockPendingOnHoldCreateCustomer(db, id);
    if (pendingBlock) {
      return pendingBlock;
    }

    const bodyResult = await readLimitedJsonBody(
      request,
      AI_FEEDBACK_COMPONENT_MAX_BODY_BYTES,
    );
    if (!bodyResult.ok) {
      throw mapBodyReadError(
        bodyResult.errorCode,
        bodyResult.httpStatus,
        bodyResult.message,
      );
    }

    const parsed = parseComponentFeedbackPutBody(bodyResult.value);
    if (!parsed.ok) {
      const status =
        parsed.errorCode === "AI_FEEDBACK_TARGET_NOT_ALLOWED" ||
        parsed.errorCode === "AI_FEEDBACK_INVALID_TAGS" ||
        parsed.errorCode === "AI_FEEDBACK_COMMENT_NOT_ALLOWED"
          ? 422
          : 400;
      throw new ComponentFeedbackApiError(
        status,
        parsed.message,
        parsed.errorCode,
      );
    }

    try {
      const result = await putComponentFeedbackForActor(
        db,
        user,
        id,
        parsed.value,
      );

      await writeAuditLog(
        {
          userId: user.id,
          action: result.created
            ? AI_FEEDBACK_COMPONENT_AUDIT_CREATED
            : AI_FEEDBACK_COMPONENT_AUDIT_UPDATED,
          entityType: "customer",
          entityId: id,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: buildComponentFeedbackAuditMetadata(
            result.feedback,
            result.created ? "create" : "update",
          ),
        },
        db,
      );

      return Response.json(result.response);
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
  } catch (error) {
    if (error instanceof ComponentFeedbackApiError) {
      return toComponentFeedbackApiErrorResponse(error);
    }
    return authErrorResponse(error);
  }
}
