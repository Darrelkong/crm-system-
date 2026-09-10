import { getRequestMeta } from "@/lib/auth/cookies";
import { changeKnowledgePassword } from "@/lib/knowledge/access-policy-service";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
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
