import { getRequestMeta } from "@/lib/auth/cookies";
import { changeKnowledgePassword } from "@/lib/knowledge/access-policy-service";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  knowledgeErrorResponse,
  requireKnowledgeAdmin,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await requireKnowledgeAdmin(request);
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
    const passwordVersion = await changeKnowledgePassword(
      context.user,
      body.password,
      { ipAddress, userAgent },
    );
    return Response.json({ ok: true, passwordVersion });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
