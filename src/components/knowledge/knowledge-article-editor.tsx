"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  KnowledgeArticleDetail,
  KnowledgeCategoryListItem,
} from "@/lib/knowledge/core-service";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";

export function KnowledgeArticleEditor({
  article,
  categories,
  role,
}: {
  article: KnowledgeArticleDetail | null;
  categories: KnowledgeCategoryListItem[];
  role: KnowledgeRole | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(article?.title ?? "");
  const [categoryId, setCategoryId] = useState(article?.categoryId ?? "");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const [visibility, setVisibility] = useState(article?.visibility ?? "team");
  const [changeNote, setChangeNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canEdit =
    role === "knowledge_admin" ||
    role === "contributor" ||
    role === "reviewer";

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
      };
      if (!response.ok || !payload.article) {
        throw new Error(payload.error ?? "文章保存失败");
      }
      router.push(`/knowledge/articles/${payload.article.id}`);
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "文章保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!article) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/knowledge/articles/${article.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archive: true,
          expectedUpdatedAt: article.updatedAt,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "归档失败");
      router.push(`/knowledge/articles/${article.id}`);
      router.refresh();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "归档失败");
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <Card>
        <p className="crm-text-secondary">你没有编辑 Knowledge 文章的权限。</p>
      </Card>
    );
  }

  return (
    <Card className="max-w-4xl">
      <form className="space-y-5" onSubmit={submit}>
        <div>
          <label htmlFor="knowledge-title" className="mb-2 block text-sm font-medium crm-text">
            标题
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
              分类
            </label>
            <select
              id="knowledge-category"
              required
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">请选择分类</option>
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
              可见范围
            </label>
            <select
              id="knowledge-visibility"
              value={visibility}
              onChange={(event) =>
                setVisibility(event.target.value as "team" | "restricted" | "owner")
              }
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="team">Team</option>
              <option value="owner">Owner（仅自己与 Admin）</option>
              {role === "knowledge_admin" && (
                <option value="restricted">Restricted（目前仅 Admin）</option>
              )}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="knowledge-summary" className="mb-2 block text-sm font-medium crm-text">
            摘要
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
            正文
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
            使用纯文字格式，避免脚本、iframe 或不安全 HTML。
          </p>
        </div>
        <div>
          <label htmlFor="knowledge-change-note" className="mb-2 block text-sm font-medium crm-text">
            修改说明（可选）
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
            保存草稿
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              router.push(article ? `/knowledge/articles/${article.id}` : "/knowledge")
            }
            disabled={busy}
          >
            取消
          </Button>
          {article && article.status !== "archived" && (
            <Button type="button" variant="danger" onClick={archive} disabled={busy}>
              归档
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
