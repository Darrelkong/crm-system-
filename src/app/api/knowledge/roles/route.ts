import { getRequestMeta } from "@/lib/auth/cookies";
import {
  knowledgeErrorResponse,
  requireKnowledgeAdmin,
} from "@/lib/permissions/knowledge";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  listKnowledgeUsers,
  setKnowledgeRole,
} from "@/lib/knowledge/role-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireKnowledgeAdmin(request);
    return Response.json({ users: await listKnowledgeUsers() });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireKnowledgeAdmin(request);
    const body = (await request.json()) as {
      userId?: unknown;
      role?: unknown;
    };
    if (typeof body.userId !== "string" || typeof body.role !== "string") {
      throw new KnowledgeServiceError(
        "KNOWLEDGE_ROLE_REQUIRED",
        "用户及 Knowledge 角色必填",
        400,
      );
    }
    const { ipAddress, userAgent } = getRequestMeta(request);
    const role = await setKnowledgeRole(
      context.user,
      body.userId,
      body.role,
      { ipAddress, userAgent },
    );
    return Response.json({ ok: true, role });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
