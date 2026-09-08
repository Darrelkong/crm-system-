import { getRequestMeta } from "@/lib/auth/cookies";
import { lockKnowledgeSession } from "@/lib/knowledge/unlock-service";
import { knowledgeErrorResponse, requireKnowledgeAccess } from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await requireKnowledgeAccess(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    await lockKnowledgeSession(
      context.sessionId,
      context.user.id,
      { ipAddress, userAgent },
    );
    return Response.json({ ok: true, redirect: "/knowledge/access" });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
