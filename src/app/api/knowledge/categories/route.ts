import { getRequestMeta } from "@/lib/auth/cookies";
import {
  createKnowledgeCategory,
  listKnowledgeCategories,
  type KnowledgeCategoryInput,
} from "@/lib/knowledge/core-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireKnowledgeAccess(request);
    return Response.json({ categories: await listKnowledgeCategories() });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireKnowledgeAccess(request);
    const input = (await request.json()) as Record<string, unknown>;
    const { ipAddress, userAgent } = getRequestMeta(request);
    const category = await createKnowledgeCategory(
      context,
      input as KnowledgeCategoryInput,
      { ipAddress, userAgent },
    );
    return Response.json({ category }, { status: 201 });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
