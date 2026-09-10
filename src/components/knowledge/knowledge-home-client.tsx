"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
        throw new Error(payload.error ?? "分类建立失败");
      }
      setCategoryName("");
      setCategoryDescription("");
      await reloadCatalog();
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : "分类建立失败");
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

  return (
    <div className="space-y-6">
      <KnowledgeSearchAiPanel />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm crm-text-secondary">
          按分类浏览内部业务资料，文章内容仅供 Knowledge 权限范围内使用。
        </p>
        <div className="flex flex-wrap gap-2">
          {(role === "contributor" || role === "knowledge_admin") && (
            <Button
              type="button"
              onClick={() => router.push("/knowledge/articles/new")}
            >
              新建草稿
            </Button>
          )}
          {(role === "contributor" || role === "knowledge_admin") && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push("/knowledge/ingest")}
            >
              来源整理
            </Button>
          )}
          {role === "contributor" && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push("/knowledge/review")}
            >
              我的审核 · My Reviews
            </Button>
          )}
          {(role === "reviewer" || role === "knowledge_admin") && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push("/knowledge/review")}
            >
              审核中心 · Review Center
            </Button>
          )}
          {role === "knowledge_admin" && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push("/knowledge/members")}
            >
              {t("knowledge.members.homeEntry")}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={lockKnowledge}
            disabled={busy}
          >
            锁定 Knowledge
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold crm-text">分类</h2>
            <div className="mt-3 space-y-1">
              <button
                type="button"
                className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                  selectedCategoryId === null
                    ? "bg-blue-50 font-semibold text-blue-700"
                    : "crm-text-secondary hover:bg-slate-50"
                }`}
                onClick={() => setSelectedCategoryId(null)}
              >
                全部文章
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
                      className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                        selectedCategoryId === category.id
                          ? "bg-blue-50 font-semibold text-blue-700"
                          : "crm-text-secondary hover:bg-slate-50"
                      }`}
                      onClick={() => setSelectedCategoryId(category.id)}
                    >
                      <span className="block truncate">{category.name}</span>
                      <span className="text-xs opacity-70">
                        {category.articleCount} 篇
                        {!category.isActive && " · 已停用"}
                      </span>
                    </button>
                    {role === "knowledge_admin" && category.isActive && (
                      <button
                        type="button"
                        className="invisible px-3 text-xs text-slate-500 underline group-hover:visible"
                        onClick={() => deactivateCategory(category)}
                        disabled={busy}
                      >
                        停用分类
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </Card>

          {role === "knowledge_admin" && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold crm-text">管理分类</h2>
              <form className="mt-3 space-y-3" onSubmit={createCategory}>
                <input
                  required
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  placeholder="分类名称"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
                <textarea
                  value={categoryDescription}
                  onChange={(event) => setCategoryDescription(event.target.value)}
                  placeholder="简短说明（可选）"
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
                {categoryError && (
                  <p className="text-xs text-red-600">{categoryError}</p>
                )}
                <Button type="submit" size="sm" disabled={busy}>
                  新增分类
                </Button>
              </form>
            </Card>
          )}
        </aside>

        <section className="min-w-0 space-y-4">
          <p className="text-sm crm-text-secondary">
            {visibleArticles.length} 篇文章
            {selectedCategoryId ? "（当前分类）" : ""}
          </p>

          {visibleArticles.length === 0 ? (
            <EmptyState
              message="此分类目前没有文章。"
              action={
                role === "contributor" || role === "knowledge_admin" ? (
                  <Button onClick={() => router.push("/knowledge/articles/new")}>
                    新建草稿
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {visibleArticles.map((article) => (
                <Card key={article.id} className="flex min-w-0 flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs crm-text-secondary">
                        {article.categoryName}
                      </p>
                      <h2 className="mt-1 truncate text-lg font-semibold crm-text">
                        {article.title}
                      </h2>
                    </div>
                    <Badge
                      variant={
                        article.status === "draft" ? "warning" : "success"
                      }
                    >
                      {article.status === "draft"
                        ? "草稿"
                        : article.status === "archived"
                          ? "已归档"
                          : "已发布"}
                    </Badge>
                  </div>
                  {article.summary && (
                    <p className="mt-3 line-clamp-3 text-sm crm-text-secondary">
                      {article.summary}
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => openQuickView(article.id)}
                      disabled={busy}
                    >
                      快速查看
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        router.push(`/knowledge/articles/${article.id}`)
                      }
                    >
                      完整文章
                    </Button>
                    <span className="ml-auto text-xs crm-text-secondary">
                      更新于 {new Date(article.updatedAt).toLocaleDateString()}
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
          aria-label="文章快速查看"
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
                关闭
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
                查看完整文章
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
                版本历史
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
