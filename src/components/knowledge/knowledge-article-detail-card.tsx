"use client";

import { useTranslation } from "@/i18n/provider";
import { Badge, Card } from "@/components/ui/card";
import { KnowledgeArticleArchiveButton } from "@/components/knowledge/knowledge-article-archive-button";
import { formatKnowledgeVisibility } from "@/lib/knowledge/review-labels";
import type { KnowledgeArticleDetail } from "@/lib/knowledge/core-service";

type Publication = {
  id: string;
  versionNumber: number;
  publishedAt: string;
  publishedByName: string;
};

export function KnowledgeArticleDetailCard({
  article,
  publications,
  canArchive,
}: {
  article: KnowledgeArticleDetail;
  publications: Publication[];
  canArchive: boolean;
}) {
  const { t } = useTranslation();

  function statusLabel() {
    if (article.status === "draft") return t("knowledge.home.statusDraft");
    if (article.status === "archived") return t("knowledge.home.statusArchived");
    return t("knowledge.home.statusPublished");
  }

  return (
    <Card className="max-w-4xl min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={article.status === "draft" ? "warning" : "success"}>
          {statusLabel()}
        </Badge>
        <Badge variant="default">
          {t("knowledge.article.versionBadge", {
            version: String(article.currentVersionNumber),
          })}
        </Badge>
        {article.publishedVersionNumber != null && (
          <Badge variant="success">
            {t("knowledge.article.publishedVersionBadge", {
              version: String(article.publishedVersionNumber),
            })}
          </Badge>
        )}
        {article.hasUnpublishedChanges && (
          <Badge variant="warning">
            {t("knowledge.review.unpublishedChanges")}
          </Badge>
        )}
        <Badge variant="accent">
          {formatKnowledgeVisibility(article.visibility, t)}
        </Badge>
      </div>
      {article.summary && (
        <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 crm-text-secondary">
          {article.summary}
        </p>
      )}
      <article className="mt-6 whitespace-pre-wrap break-words text-sm leading-8 crm-text">
        {article.body}
      </article>
      {publications.length > 0 && (
        <div className="mt-8 border-t border-slate-200 pt-5">
          <h2 className="text-sm font-semibold crm-text">
            {t("knowledge.article.publicationHistory")}
          </h2>
          <div className="mt-3 space-y-2">
            {publications.map((publication) => (
              <div
                key={publication.id}
                className="rounded-xl bg-slate-50 px-3 py-2 text-sm crm-text-secondary"
              >
                Version {publication.versionNumber} ·{" "}
                {new Date(publication.publishedAt).toLocaleString()} ·{" "}
                {publication.publishedByName}
              </div>
            ))}
          </div>
        </div>
      )}
      {canArchive && (
        <KnowledgeArticleArchiveButton
          articleId={article.id}
          updatedAt={article.updatedAt}
        />
      )}
    </Card>
  );
}
