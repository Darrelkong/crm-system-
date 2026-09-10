export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { KnowledgeArticleHistoryClient } from "@/components/knowledge/knowledge-article-history-client";
import {
  listKnowledgeArticlePublications,
} from "@/lib/knowledge/review-service";
import {
  getKnowledgeArticle,
  getKnowledgeArticleVersion,
  listKnowledgeArticleVersions,
} from "@/lib/knowledge/core-service";
import { requireKnowledgeAccess } from "@/lib/permissions/knowledge";

type PageContext = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
};

export default async function KnowledgeArticleHistoryPage(
  context: PageContext,
) {
  const [{ id }, searchParams] = await Promise.all([
    context.params,
    context.searchParams,
  ]);
  const actor = await requireKnowledgeAccess();
  const article = await getKnowledgeArticle(actor, id).catch(() => null);
  if (!article) notFound();
  const [versions, publications] = await Promise.all([
    listKnowledgeArticleVersions(actor, id),
    listKnowledgeArticlePublications(actor, id).catch(() => []),
  ]);
  const publishedVersions = new Set(
    publications.map((publication) => publication.versionNumber),
  );
  const requestedVersion = searchParams.version
    ? Number(searchParams.version)
    : null;
  const selected =
    requestedVersion && Number.isSafeInteger(requestedVersion)
      ? await getKnowledgeArticleVersion(
          actor,
          id,
          requestedVersion,
          {},
        ).catch(() => null)
      : null;

  return (
    <KnowledgeArticleHistoryClient
      article={article}
      articleId={id}
      versions={versions}
      publishedVersions={publishedVersions}
      selected={selected}
    />
  );
}
