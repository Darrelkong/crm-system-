"use client";

import { useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FilePlus,
  FileText,
  FolderInput,
  Lock,
  Shield,
  Users,
} from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { KnowledgeSearchAiPanel } from "@/components/knowledge/knowledge-search-ai-panel";
import type {
  KnowledgeArticleDetail,
  KnowledgeArticleListItem,
  KnowledgeCategoryListItem,
} from "@/lib/knowledge/core-service";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";

type Catalog = {
  categories: KnowledgeCategoryListItem[];
  articles: KnowledgeArticleListItem[];
};

type HomeAction = {
  key: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

function buildHomeActions(
  role: KnowledgeRole | null,
  canAuthor: boolean,
  t: (key: string) => string,
): HomeAction[] {
  const actions: HomeAction[] = [];

  if (canAuthor) {
    actions.push({
      key: "newDraft",
      label: t("knowledge.home.newDraft"),
      href: "/knowledge/articles/new",
      icon: FilePlus,
    });
    actions.push({
      key: "ingest",
      label: t("knowledge.home.ingest"),
      href: "/knowledge/ingest",
      icon: FolderInput,
    });
  }

  if (role === "contributor") {
    actions.push({
      key: "myReviews",
      label: t("knowledge.home.myReviews"),
      href: "/knowledge/review",
      icon: ClipboardCheck,
    });
  }

  if (role === "reviewer" || role === "knowledge_admin") {
    actions.push({
      key: "reviewCenter",
      label: t("knowledge.home.reviewCenter"),
      href: "/knowledge/review",
      icon: CheckCircle2,
    });
  }

  if (role === "knowledge_admin") {
    actions.push({
      key: "members",
      label: t("knowledge.members.homeEntry"),
      href: "/knowledge/members",
      icon: Users,
    });
  }

  return actions;
}

export function KnowledgeHomeClient({
  initialCatalog,
  role,
}: {
  initialCatalog: Catalog;
  role: KnowledgeRole | null;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [catalog] = useState(initialCatalog);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [selectedArticle, setSelectedArticle] =
    useState<KnowledgeArticleDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const canAuthor =
    role === "contributor" || role === "knowledge_admin";

  const homeActions = useMemo(
    () => buildHomeActions(role, canAuthor, t),
    [role, canAuthor, t],
  );

  const visibleArticles = useMemo(() => {
    return catalog.articles.filter((article) => {
      if (selectedCategoryId && article.categoryId !== selectedCategoryId) {
        return false;
      }
      return true;
    });
  }, [catalog.articles, selectedCategoryId]);

  const visibleCategories = useMemo(
    () =>
      catalog.categories.filter(
        (category) => category.isActive || role === "knowledge_admin",
      ),
    [catalog.categories, role],
  );

  function articleStatusLabel(status: KnowledgeArticleListItem["status"]) {
    if (status === "draft") return t("knowledge.home.statusDraft");
    if (status === "archived") return t("knowledge.home.statusArchived");
    return t("knowledge.home.statusPublished");
  }

  async function openQuickView(articleId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/knowledge/articles/${articleId}`, {
        cache: "no-store",
      });
      if (response.ok) {
        const payload = (await response.json()) as {
          article: KnowledgeArticleDetail;
        };
        setSelectedArticle(payload.article);
      }
    } finally {
      setBusy(false);
    }
  }

  async function lockKnowledge() {
    setBusy(true);
    try {
      const response = await fetch("/api/knowledge/lock", { method: "POST" });
      if (response.ok) {
        router.replace("/knowledge/access");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <KnowledgeSearchAiPanel />

      <div
        className="flex gap-2 rounded-lg border border-slate-200/80 bg-slate-50/80 px-2.5 py-2 text-xs leading-relaxed crm-text-secondary"
        role="note"
      >
        <Shield
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500"
          aria-hidden
        />
        <p>{t("knowledge.home.confidentialityNotice")}</p>
      </div>

      {homeActions.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {homeActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.key}
                href={action.href}
                data-home-action={action.key}
                className="flex min-h-[4.5rem] flex-col items-start justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 active:bg-slate-100"
              >
                <Icon className="h-4 w-4 text-blue-600" aria-hidden />
                <span className="text-sm font-medium leading-tight crm-text">
                  {action.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg text-sm crm-text-secondary transition-colors hover:bg-slate-50 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        onClick={lockKnowledge}
        disabled={busy}
        data-home-lock="true"
      >
        <Lock className="h-3.5 w-3.5" aria-hidden />
        {t("knowledge.home.lockKnowledge")}
      </button>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold crm-text">
            {t("knowledge.home.categories")}
          </h2>
          {role === "knowledge_admin" && (
            <Link
              href="/knowledge/categories"
              data-category-manage-link="true"
              className="inline-flex items-center gap-0.5 text-sm text-blue-700 hover:underline"
            >
              {t("knowledge.home.manageCategoriesLink")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
          <button
            type="button"
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
              selectedCategoryId === null
                ? "bg-blue-50 font-medium text-blue-700"
                : "border border-slate-200 bg-white crm-text-secondary"
            }`}
            onClick={() => setSelectedCategoryId(null)}
          >
            {t("knowledge.home.allArticles")}
          </button>
          {visibleCategories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                selectedCategoryId === category.id
                  ? "bg-blue-50 font-medium text-blue-700"
                  : "border border-slate-200 bg-white crm-text-secondary"
              }`}
              onClick={() => setSelectedCategoryId(category.id)}
            >
              {category.name}
              {!category.isActive && t("knowledge.home.inactiveSuffix")}
            </button>
          ))}
        </div>

        <h3 className="text-sm font-medium crm-text">
          {t("knowledge.home.articlesHeading")}
        </h3>

        {visibleArticles.length === 0 ? (
          <div
            className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center"
            data-home-empty-articles="true"
          >
            <FileText
              className="h-7 w-7 text-slate-300"
              aria-hidden
            />
            <p className="mt-2 text-sm crm-text-secondary">
              {t("knowledge.home.noArticlesYet")}
            </p>
            {canAuthor && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="mt-3 min-h-9"
                onClick={() => router.push("/knowledge/articles/new")}
              >
                {t("knowledge.home.createFirstDraft")}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2 xl:gap-3">
            {visibleArticles.map((article) => (
              <Card key={article.id} className="flex min-w-0 flex-col p-3 sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs crm-text-secondary">
                      {article.categoryName}
                    </p>
                    <h3 className="mt-0.5 truncate text-base font-semibold crm-text">
                      {article.title}
                    </h3>
                  </div>
                  <Badge
                    variant={
                      article.status === "draft" ? "warning" : "success"
                    }
                  >
                    {articleStatusLabel(article.status)}
                  </Badge>
                </div>
                {article.summary && (
                  <p className="mt-2 line-clamp-2 text-sm crm-text-secondary">
                    {article.summary}
                  </p>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => openQuickView(article.id)}
                    disabled={busy}
                  >
                    {t("knowledge.home.quickView")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      router.push(`/knowledge/articles/${article.id}`)
                    }
                  >
                    {t("knowledge.home.fullArticle")}
                  </Button>
                  <span className="ml-auto text-xs crm-text-secondary">
                    {t("knowledge.home.updatedAt", {
                      date: new Date(article.updatedAt).toLocaleDateString(),
                    })}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {selectedArticle && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={t("knowledge.home.quickViewDialogLabel")}
          onClick={() => setSelectedArticle(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs crm-text-secondary">
                  {selectedArticle.categoryName}
                </p>
                <h2 className="mt-1 text-xl font-semibold crm-text">
                  {selectedArticle.title}
                </h2>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelectedArticle(null)}
              >
                {t("knowledge.home.close")}
              </Button>
            </div>
            {selectedArticle.summary && (
              <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm crm-text-secondary">
                {selectedArticle.summary}
              </p>
            )}
            <div className="mt-5 whitespace-pre-wrap break-words text-sm leading-7 crm-text">
              {selectedArticle.body}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  router.push(`/knowledge/articles/${selectedArticle.id}`)
                }
              >
                {t("knowledge.home.viewFullArticle")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  router.push(
                    `/knowledge/articles/${selectedArticle.id}/history`,
                  )
                }
              >
                {t("knowledge.home.versionHistory")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
