"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
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

export function KnowledgeHomeClient({
  initialCatalog,
  role,
}: {
  initialCatalog: Catalog;
  role: KnowledgeRole | null;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState(initialCatalog);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [selectedArticle, setSelectedArticle] =
    useState<KnowledgeArticleDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const visibleArticles = useMemo(() => {
    return catalog.articles.filter((article) => {
      if (selectedCategoryId && article.categoryId !== selectedCategoryId) {
        return false;
      }
      return true;
    });
  }, [catalog.articles, selectedCategoryId]);

  const articleCountLabel = selectedCategoryId
    ? t("knowledge.home.articleCountFiltered", {
        count: String(visibleArticles.length),
      })
    : t("knowledge.home.articleCount", {
        count: String(visibleArticles.length),
      });

  function articleStatusLabel(status: KnowledgeArticleListItem["status"]) {
    if (status === "draft") return t("knowledge.home.statusDraft");
    if (status === "archived") return t("knowledge.home.statusArchived");
    return t("knowledge.home.statusPublished");
  }

  async function reloadCatalog() {
    const response = await fetch("/api/knowledge/catalog", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("catalog");
    const payload = (await response.json()) as { catalog: Catalog };
    setCatalog(payload.catalog);
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

  async function createCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCategoryError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/knowledge/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: categoryName,
          description: categoryDescription,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(
          payload.error ?? t("knowledge.home.createCategoryFailed"),
        );
      }
      setCategoryName("");
      setCategoryDescription("");
      await reloadCatalog();
    } catch (error) {
      setCategoryError(
        error instanceof Error
          ? error.message
          : t("knowledge.home.createCategoryFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function deactivateCategory(category: KnowledgeCategoryListItem) {
    setBusy(true);
    try {
      await fetch(`/api/knowledge/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: category.name,
          description: category.description ?? "",
          sortOrder: category.sortOrder,
          isActive: false,
          expectedUpdatedAt: category.updatedAt,
        }),
      });
      await reloadCatalog();
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

  const canAuthor =
    role === "contributor" || role === "knowledge_admin";

  return (
    <div className="space-y-4 md:space-y-6">
      <KnowledgeSearchAiPanel />

      <div
        className="flex gap-2 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed crm-text-secondary"
        role="note"
      >
        <Shield
          className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
          aria-hidden
        />
        <p>{t("knowledge.home.confidentialityNotice")}</p>
      </div>

      <div className="space-y-3">
        <p className="hidden text-sm crm-text-secondary md:block">
          {t("knowledge.home.browseHint")}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {canAuthor && (
            <Button
              type="button"
              className="col-span-2 min-h-11 w-full"
              onClick={() => router.push("/knowledge/articles/new")}
            >
              {t("knowledge.home.newDraft")}
            </Button>
          )}
          {canAuthor && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full"
              onClick={() => router.push("/knowledge/ingest")}
            >
              {t("knowledge.home.ingest")}
            </Button>
          )}
          {role === "contributor" && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full"
              onClick={() => router.push("/knowledge/review")}
            >
              {t("knowledge.home.myReviews")}
            </Button>
          )}
          {(role === "reviewer" || role === "knowledge_admin") && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full"
              onClick={() => router.push("/knowledge/review")}
            >
              {t("knowledge.home.reviewCenter")}
            </Button>
          )}
          {role === "knowledge_admin" && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full"
              onClick={() => router.push("/knowledge/members")}
            >
              {t("knowledge.members.homeEntry")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="col-span-2 min-h-11 w-full border border-slate-200 bg-white"
            onClick={lockKnowledge}
            disabled={busy}
          >
            {t("knowledge.home.lockKnowledge")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)] lg:gap-6">
        <aside className="space-y-3 lg:space-y-4">
          <Card className="p-3 sm:p-4">
            <h2 className="text-sm font-semibold crm-text">
              {t("knowledge.home.categories")}
            </h2>
            <div className="mt-2 space-y-0.5">
              <button
                type="button"
                className={`w-full rounded-lg px-2.5 py-2 text-left text-sm ${
                  selectedCategoryId === null
                    ? "bg-blue-50 font-semibold text-blue-700"
                    : "crm-text-secondary hover:bg-slate-50"
                }`}
                onClick={() => setSelectedCategoryId(null)}
              >
                {t("knowledge.home.allArticles")}
              </button>
              {catalog.categories
                .filter(
                  (category) =>
                    category.isActive || role === "knowledge_admin",
                )
                .map((category) => (
                  <div key={category.id} className="group">
                    <button
                      type="button"
                      className={`w-full rounded-lg px-2.5 py-2 text-left text-sm ${
                        selectedCategoryId === category.id
                          ? "bg-blue-50 font-semibold text-blue-700"
                          : "crm-text-secondary hover:bg-slate-50"
                      }`}
                      onClick={() => setSelectedCategoryId(category.id)}
                    >
                      <span className="block truncate">{category.name}</span>
                      <span className="text-xs opacity-70">
                        {category.articleCount} {t("knowledge.home.articlesUnit")}
                        {!category.isActive && t("knowledge.home.inactiveSuffix")}
                      </span>
                    </button>
                    {role === "knowledge_admin" && category.isActive && (
                      <button
                        type="button"
                        className="invisible px-2.5 text-xs text-slate-500 underline group-hover:visible"
                        onClick={() => deactivateCategory(category)}
                        disabled={busy}
                      >
                        {t("knowledge.home.deactivateCategory")}
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </Card>

          {role === "knowledge_admin" && (
            <Card className="p-3 sm:p-4">
              <h2 className="text-sm font-semibold crm-text">
                {t("knowledge.home.manageCategories")}
              </h2>
              <form className="mt-2 space-y-2" onSubmit={createCategory}>
                <input
                  required
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  placeholder={t("knowledge.home.categoryName")}
                  aria-label={t("knowledge.home.categoryName")}
                  className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
                <textarea
                  value={categoryDescription}
                  onChange={(event) =>
                    setCategoryDescription(event.target.value)
                  }
                  placeholder={t("knowledge.home.categoryDescription")}
                  aria-label={t("knowledge.home.categoryDescription")}
                  rows={2}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
                {categoryError && (
                  <p className="text-xs text-red-600">{categoryError}</p>
                )}
                <Button type="submit" size="sm" className="min-h-10" disabled={busy}>
                  {t("knowledge.home.addCategory")}
                </Button>
              </form>
            </Card>
          )}
        </aside>

        <section className="min-w-0 space-y-3">
          <p className="text-sm crm-text-secondary">{articleCountLabel}</p>

          {visibleArticles.length === 0 ? (
            <EmptyState
              message={t("knowledge.home.emptyCategory")}
              action={
                canAuthor ? (
                  <Button
                    size="sm"
                    onClick={() => router.push("/knowledge/articles/new")}
                  >
                    {t("knowledge.home.newDraft")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {visibleArticles.map((article) => (
                <Card key={article.id} className="flex min-w-0 flex-col p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs crm-text-secondary">
                        {article.categoryName}
                      </p>
                      <h3 className="mt-1 truncate text-base font-semibold crm-text">
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
                    <p className="mt-2 line-clamp-3 text-sm crm-text-secondary">
                      {article.summary}
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
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
      </div>

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
