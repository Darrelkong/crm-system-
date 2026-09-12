import { readFile } from "node:fs/promises";
import {
  getKnowledgePreviewFixture,
  getKnowledgePreviewFixturePath,
  isKnowledgePreviewFixturesEnabled,
} from "@/lib/knowledge/knowledge-preview-fixtures";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ fixtureId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  if (!isKnowledgePreviewFixturesEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const { fixtureId } = await context.params;
  const fixture = getKnowledgePreviewFixture(fixtureId);
  if (!fixture) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const bytes = await readFile(getKnowledgePreviewFixturePath(fixture));
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": fixture.mimeType,
        "content-disposition": `attachment; filename="${fixture.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
