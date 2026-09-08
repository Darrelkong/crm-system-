import {
  getCurrentSession,
} from "@/lib/auth/session";
import {
  authErrorResponse,
  AuthError,
  requireAuth,
} from "@/lib/permissions/auth";
import {
  KNOWLEDGE_ERROR_CODES,
} from "@/lib/knowledge/constants";
import {
  assertKnowledgeAccess,
  getKnowledgeAccessStatus,
  type KnowledgeAccessStatus,
} from "@/lib/knowledge/unlock-service";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  getKnowledgeRole,
  hasKnowledgeRoleAtLeast,
} from "@/lib/knowledge/role-service";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import type { User } from "../../../drizzle/schema/users";

export type KnowledgeSessionContext = {
  user: User;
  sessionId: string;
  role: KnowledgeRole | null;
};

export async function requireKnowledgeSession(
  request?: Request,
): Promise<KnowledgeSessionContext> {
  const user = await requireAuth(request);
  const session = await getCurrentSession({ touch: false });
  if (!session || session.user.id !== user.id) {
    throw new AuthError(
      401,
      "CRM 会话无效",
      "auth.session.invalid",
      "SESSION_INVALID",
    );
  }
  return {
    user,
    sessionId: session.sessionId,
    role: await getKnowledgeRole(user.id),
  };
}

export async function getKnowledgeSessionStatus(
  request?: Request,
): Promise<KnowledgeSessionContext & { access: KnowledgeAccessStatus }> {
  const context = await requireKnowledgeSession(request);
  return {
    ...context,
    access: await getKnowledgeAccessStatus(
      context.sessionId,
      context.user.id,
      context.role,
    ),
  };
}

export async function requireKnowledgeAccess(
  request?: Request,
): Promise<KnowledgeSessionContext> {
  const context = await requireKnowledgeSession(request);
  await assertKnowledgeAccess(
    context.sessionId,
    context.user.id,
    context.role,
  );
  return context;
}

export async function requireKnowledgeRole(
  minimumRole: KnowledgeRole,
  request?: Request,
): Promise<KnowledgeSessionContext> {
  const context = await requireKnowledgeAccess(request);
  if (
    !context.role ||
    !hasKnowledgeRoleAtLeast(context.role, minimumRole)
  ) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ROLE_REQUIRED,
      "Knowledge 权限不足",
      403,
    );
  }
  return context;
}

export async function requireKnowledgeAdmin(
  request?: Request,
): Promise<KnowledgeSessionContext> {
  const context = await requireKnowledgeRole("knowledge_admin", request);
  return context;
}

export function knowledgeErrorResponse(error: unknown): Response {
  if (error instanceof KnowledgeServiceError) {
    return Response.json(
      {
        error: error.message,
        errorCode: error.errorCode,
      },
      { status: error.httpStatus },
    );
  }
  return authErrorResponse(error);
}
