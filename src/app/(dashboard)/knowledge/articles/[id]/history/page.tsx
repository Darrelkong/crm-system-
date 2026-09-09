export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
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
    <div>
      <PageIntro
        title={`版本历史 · ${article.title}`}
        description="历史版本仅供查看，Package 2 不提供一键恢复。"
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/knowledge/articles/${id}`}
              className="secondary-button inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm"
            >
              返回文章
            </Link>
            {!article.isPublishedSnapshot &&
              article.status !== "archived" &&
              (actor.role === "contributor" ||
                actor.role === "reviewer" ||
                actor.role === "knowledge_admin") && (
                <Link
                  href={`/knowledge/articles/${id}/edit`}
                  className="primary-button inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm text-white"
                >
                  编辑文章
                </Link>
              )}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(12rem,18rem)_minmax(0,1fr)]">
        <Card className="p-4">
          <h2 className="text-sm font-semibold crm-text">版本</h2>
          <div className="mt-3 space-y-2">
            {versions.map((version) => (
              <Link
                key={version.id}
                href={`/knowledge/articles/${id}/history?version=${version.versionNumber}`}
                className={`block rounded-xl border px-3 py-3 text-sm ${
                  selected?.versionNumber === version.versionNumber
                    ? "border-blue-300 bg-blue-50"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold crm-text">
                    Version {version.versionNumber}
                  </span>
                  {version.versionNumber === article.currentVersionNumber && (
                    <Badge variant="success">当前</Badge>
                  )}
                  {version.versionNumber === article.publishedVersionNumber && (
                    <Badge variant="accent">目前已发布</Badge>
                  )}
                  {publishedVersions.has(version.versionNumber) &&
                    version.versionNumber !== article.publishedVersionNumber && (
                      <Badge variant="default">曾发布</Badge>
                    )}
                </div>
                <p className="mt-1 text-xs crm-text-secondary">
                  {new Date(version.createdAt).toLocaleString()}
                </p>
                {version.changeNote && (
                  <p className="mt-1 line-clamp-2 text-xs crm-text-secondary">
                    {version.changeNote}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </Card>
        <Card>
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">Version {selected.versionNumber}</Badge>
                <span className="text-xs crm-text-secondary">
                  {new Date(selected.createdAt).toLocaleString()}
                </span>
              </div>
              <h2 className="mt-4 text-xl font-semibold crm-text">
                {selected.titleSnapshot}
              </h2>
              {selected.summarySnapshot && (
                <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm crm-text-secondary">
                  {selected.summarySnapshot}
                </p>
              )}
              <article className="mt-5 whitespace-pre-wrap break-words text-sm leading-8 crm-text">
                {selected.bodySnapshot}
              </article>
            </>
          ) : (
            <div className="py-10 text-center text-sm crm-text-secondary">
              请选择一个历史版本查看。
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
