"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  KnowledgeArticleDetail,
  KnowledgeCategoryListItem,
} from "@/lib/knowledge/core-service";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";

export function KnowledgeArticleEditor({
  article,
  categories,
  role,
}: {
  article: KnowledgeArticleDetail | null;
  categories: KnowledgeCategoryListItem[];
  role: KnowledgeRole | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [title, setTitle] = useState(article?.title ?? "");
  const [categoryId, setCategoryId] = useState(article?.categoryId ?? "");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const [visibility, setVisibility] = useState(article?.visibility ?? "team");
  const [changeNote, setChangeNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canEdit = role === "knowledge_admin" || role === "contributor";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(
        article
          ? `/api/knowledge/articles/${article.id}`
          : "/api/knowledge/articles",
        {
          method: article ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            categoryId,
            summary,
            body,
            visibility,
            changeNote,
            ...(article ? { expectedUpdatedAt: article.updatedAt } : {}),
          }),
        },
      );
      const payload = (await response.json()) as {
        article?: KnowledgeArticleDetail;
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.article) {
        throw new Error(
          resolveKnowledgeApiError(t, payload, "knowledge.article.saveFailed"),
        );
      }
      router.push(`/knowledge/articles/${payload.article.id}`);
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : t("knowledge.article.saveFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <Card>
        <p className="crm-text-secondary">
          {t("knowledge.article.noEditPermission")}
        </p>
      </Card>
    );
  }

  return (
    <Card className="max-w-4xl">
      <form className="space-y-5" onSubmit={submit}>
        <div>
          <label htmlFor="knowledge-title" className="mb-2 block text-sm font-medium crm-text">
            {t("knowledge.article.titleLabel")}
          </label>
          <input
            id="knowledge-title"
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="knowledge-category" className="mb-2 block text-sm font-medium crm-text">
              {t("knowledge.article.categoryLabel")}
            </label>
            <select
              id="knowledge-category"
              required
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">{t("knowledge.article.selectCategory")}</option>
              {categories
                .filter((category) => category.isActive)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor="knowledge-visibility" className="mb-2 block text-sm font-medium crm-text">
              {t("knowledge.article.visibilityLabel")}
            </label>
            <select
              id="knowledge-visibility"
              value={visibility}
              onChange={(event) =>
                setVisibility(event.target.value as "team" | "restricted" | "owner")
              }
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="team">{t("knowledge.article.visibilityTeam")}</option>
              <option value="owner">{t("knowledge.article.visibilityOwner")}</option>
              {role === "knowledge_admin" && (
                <option value="restricted">
                  {t("knowledge.article.visibilityRestricted")}
                </option>
              )}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="knowledge-summary" className="mb-2 block text-sm font-medium crm-text">
            {t("knowledge.article.summaryLabel")}
          </label>
          <textarea
            id="knowledge-summary"
            maxLength={1000}
            rows={3}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="knowledge-body" className="mb-2 block text-sm font-medium crm-text">
            {t("knowledge.article.bodyLabel")}
          </label>
          <textarea
            id="knowledge-body"
            required
            maxLength={100000}
            rows={16}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6"
          />
          <p className="mt-2 text-xs crm-text-secondary">
            {t("knowledge.article.bodyHint")}
          </p>
        </div>
        <div>
          <label htmlFor="knowledge-change-note" className="mb-2 block text-sm font-medium crm-text">
            {t("knowledge.article.changeNoteLabel")}
          </label>
          <input
            id="knowledge-change-note"
            maxLength={500}
            value={changeNote}
            onChange={(event) => setChangeNote(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {t("knowledge.article.saveDraft")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              router.push(article ? `/knowledge/articles/${article.id}` : "/knowledge")
            }
            disabled={busy}
          >
            {t("knowledge.article.cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
