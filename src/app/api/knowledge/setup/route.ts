import { getRequestMeta } from "@/lib/auth/cookies";
import { bootstrapKnowledge } from "@/lib/knowledge/access-policy-service";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  knowledgeErrorResponse,
  requireKnowledgeSession,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await requireKnowledgeSession(request);
    if (context.user.role !== "admin") {
      throw new KnowledgeServiceError(
        KNOWLEDGE_ERROR_CODES.ADMIN_REQUIRED,
        "CRM administrator required",
        403,
      );
    }

    const body = (await request.json()) as {
      password?: unknown;
      confirmPassword?: unknown;
    };
    if (
      typeof body.password !== "string" ||
      typeof body.confirmPassword !== "string"
    ) {
      throw new KnowledgeServiceError(
        KNOWLEDGE_ERROR_CODES.PASSWORD_REQUIRED,
        "Knowledge password required",
        400,
      );
    }
    if (body.password !== body.confirmPassword) {
      throw new KnowledgeServiceError(
        KNOWLEDGE_ERROR_CODES.PASSWORD_MISMATCH,
        "Knowledge password mismatch",
        400,
      );
    }

    const { ipAddress, userAgent } = getRequestMeta(request);
    await bootstrapKnowledge(
      context.user,
      body.password,
      context.sessionId,
      { ipAddress, userAgent },
    );
    return Response.json({ ok: true, redirect: "/knowledge" });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
