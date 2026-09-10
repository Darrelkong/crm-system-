"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { KnowledgeCategoryListItem } from "@/lib/knowledge/core-service";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";

export function KnowledgeCategoriesClient({
  initialCategories,
}: {
  initialCategories: KnowledgeCategoryListItem[];
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [categories, setCategories] = useState(initialCategories);
  const [busy, setBusy] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);

  async function reloadCategories() {
    const response = await fetch("/api/knowledge/catalog", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("catalog");
    const payload = (await response.json()) as {
      catalog: { categories: KnowledgeCategoryListItem[] };
    };
    setCategories(payload.catalog.categories);
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
        const payload = (await response.json()) as {
          error?: string;
          errorCode?: string;
        };
        throw new Error(
          resolveKnowledgeApiError(
            t,
            payload,
            "knowledge.home.createCategoryFailed",
          ),
        );
      }
      setCategoryName("");
      setCategoryDescription("");
      await reloadCategories();
      router.refresh();
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
      await reloadCategories();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-3 sm:p-4">
        <h2 className="text-sm font-semibold crm-text">
          {t("knowledge.home.manageCategories")}
        </h2>
        <form className="mt-3 space-y-2" onSubmit={createCategory}>
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
            onChange={(event) => setCategoryDescription(event.target.value)}
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

      <div className="space-y-2">
        {categories.map((category) => (
          <div
            key={category.id}
            className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium crm-text">
                {category.name}
                {!category.isActive && t("knowledge.home.inactiveSuffix")}
              </p>
              {category.description ? (
                <p className="mt-0.5 line-clamp-2 text-xs crm-text-secondary">
                  {category.description}
                </p>
              ) : null}
              <p className="mt-0.5 text-xs crm-text-secondary">
                {category.articleCount} {t("knowledge.home.articlesUnit")}
              </p>
            </div>
            {category.isActive && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="shrink-0 text-xs"
                onClick={() => void deactivateCategory(category)}
                disabled={busy}
              >
                {t("knowledge.home.deactivateCategory")}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
