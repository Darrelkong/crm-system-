"use client";

import Link from "next/link";
import { useTranslation } from "@/i18n/provider";
import { Badge, Card } from "@/components/ui/card";
import { KnowledgeLocalizedPageIntro } from "@/components/knowledge/knowledge-localized-page-intro";
import { KnowledgeBackLinkLocalized } from "@/components/knowledge/knowledge-back-link-localized";
import type {
  KnowledgeArticleDetail,
  KnowledgeArticleVersionView,
} from "@/lib/knowledge/core-service";

export function KnowledgeArticleHistoryClient({
  article,
  articleId,
  versions,
  publishedVersions,
  selected,
}: {
  article: KnowledgeArticleDetail;
  articleId: string;
  versions: KnowledgeArticleVersionView[];
  publishedVersions: Set<number>;
  selected: KnowledgeArticleVersionView | null;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <KnowledgeLocalizedPageIntro
        titleKey="knowledge.article.historyTitle"
        titleParams={{ title: article.title }}
        descriptionKey="knowledge.article.historyDescription"
        action={
          <KnowledgeBackLinkLocalized
            href={`/knowledge/articles/${articleId}`}
            labelKey="knowledge.article.backToArticle"
          />
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(12rem,18rem)_minmax(0,1fr)]">
        <Card className="p-4">
          <h2 className="text-sm font-semibold crm-text">
            {t("knowledge.article.versionsHeading")}
          </h2>
          <div className="mt-3 space-y-2">
            {versions.map((version) => (
              <Link
                key={version.id}
                href={`/knowledge/articles/${articleId}/history?version=${version.versionNumber}`}
                className={`block rounded-xl border px-3 py-3 text-sm ${
                  selected?.versionNumber === version.versionNumber
                    ? "border-blue-300 bg-blue-50"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold crm-text">
                    Version {version.versionNumber}
                  </span>
                  {version.versionNumber === article.currentVersionNumber && (
                    <Badge variant="success">
                      {t("knowledge.article.currentBadge")}
                    </Badge>
                  )}
                  {version.versionNumber === article.publishedVersionNumber && (
                    <Badge variant="accent">
                      {t("knowledge.article.currentlyPublishedBadge")}
                    </Badge>
                  )}
                  {publishedVersions.has(version.versionNumber) &&
                    version.versionNumber !== article.publishedVersionNumber && (
                      <Badge variant="default">
                        {t("knowledge.article.previouslyPublishedBadge")}
                      </Badge>
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
              {t("knowledge.article.selectVersionPrompt")}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
