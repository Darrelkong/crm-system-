import { getRequestMeta } from "@/lib/auth/cookies";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { verifyKnowledgePassword } from "@/lib/knowledge/unlock-service";
import { knowledgeErrorResponse, requireKnowledgeSession } from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await requireKnowledgeSession(request);
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password !== "string") {
      throw new KnowledgeServiceError(
        KNOWLEDGE_ERROR_CODES.PASSWORD_REQUIRED,
        "Knowledge password required",
        400,
      );
    }

    const { ipAddress, userAgent } = getRequestMeta(request);
    await verifyKnowledgePassword(
      context.sessionId,
      context.user.id,
      context.role,
      body.password,
      { ipAddress, userAgent },
    );
    return Response.json({ ok: true, redirect: "/knowledge" });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
