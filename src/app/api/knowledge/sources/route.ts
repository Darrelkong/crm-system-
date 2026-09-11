import { getRequestMeta } from "@/lib/auth/cookies";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  createKnowledgeFileSource,
  createKnowledgePasteSource,
  listKnowledgeSources,
} from "@/lib/knowledge/source-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireKnowledgeAccess(request);
    const lifecycle = new URL(request.url).searchParams.get("lifecycle");
    return Response.json({
      sources: await listKnowledgeSources(context, {
        lifecycle: lifecycle === "archived" ? "archived" : "active",
      }),
    });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireKnowledgeAccess(request);
    const meta = getRequestMeta(request);
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.toLocaleLowerCase().includes("multipart/form-data")) {
      const form = await request.formData();
      const candidate = form.get("file");
      if (
        !candidate ||
        typeof candidate !== "object" ||
        typeof (candidate as File).arrayBuffer !== "function"
      ) {
        throw new KnowledgeServiceError(
          KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
          "Knowledge source file required",
          400,
        );
      }
      const source = await createKnowledgeFileSource(
        context,
        candidate as File,
        meta,
      );
      return Response.json({ source }, { status: 201 });
    }

    const input = (await request.json()) as Record<string, unknown>;
    const source = await createKnowledgePasteSource(context, input, meta);
    return Response.json({ source }, { status: 201 });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
