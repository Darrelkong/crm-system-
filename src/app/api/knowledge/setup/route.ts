import { getRequestMeta } from "@/lib/auth/cookies";
import { bootstrapKnowledge } from "@/lib/knowledge/access-policy-service";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  knowledgeErrorResponse,
  requireKnowledgeSession,
} from "@/lib/permissions/knowledge";
import { AuthError } from "@/lib/permissions/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await requireKnowledgeSession(request);
    if (context.user.role !== "admin") {
      throw new AuthError(403, "需要 CRM 管理员权限");
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
        "KNOWLEDGE_PASSWORD_REQUIRED",
        "请输入 Knowledge 密码及确认密码",
        400,
      );
    }
    if (body.password !== body.confirmPassword) {
      throw new KnowledgeServiceError(
        "KNOWLEDGE_PASSWORD_MISMATCH",
        "两次输入的 Knowledge 密码不一致",
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
