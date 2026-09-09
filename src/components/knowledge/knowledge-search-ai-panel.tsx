"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import type { KnowledgeAiAnswer } from "@/lib/knowledge/qa-service";
import type { KnowledgeSearchResult } from "@/lib/knowledge/published-retrieval";

type Mode = "search" | "ask";

export function KnowledgeSearchAiPanel() {
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [answer, setAnswer] = useState<KnowledgeAiAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      if (mode === "search") {
        const response = await fetch(
          `/api/knowledge/search?q=${encodeURIComponent(value)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as {
          results?: KnowledgeSearchResult[];
          error?: string;
        };
        if (!response.ok || !payload.results) {
          throw new Error(payload.error ?? "搜索失败");
        }
        setResults(payload.results);
      } else {
        const response = await fetch("/api/knowledge/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: value }),
        });
        const payload = (await response.json()) as {
          answer?: KnowledgeAiAnswer;
          error?: string;
        };
        if (!response.ok || !payload.answer) {
          throw new Error(payload.error ?? "Knowledge AI 暂时无法使用");
        }
        setAnswer(payload.answer);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "请求失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-blue-100 bg-blue-50/40">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "search" ? "primary" : "secondary"}
          onClick={() => {
            setMode("search");
            setResults([]);
            setAnswer(null);
            setError(null);
          }}
        >
          搜索 Knowledge
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "ask" ? "primary" : "secondary"}
          onClick={() => {
            setMode("ask");
            setResults([]);
            setAnswer(null);
            setError(null);
          }}
        >
          Ask Knowledge AI
        </Button>
      </div>
      <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={submit}>
        {mode === "ask" ? (
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="只会根据已发布 Knowledge 回答"
            aria-label="Ask Knowledge AI"
            maxLength={200}
            rows={3}
            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
          />
        ) : (
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索已发布 Knowledge"
            aria-label="搜索 Knowledge"
            maxLength={200}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm"
          />
        )}
        <Button type="submit" disabled={busy || !query.trim()}>
          {busy ? "处理中…" : mode === "search" ? "搜索" : "提问"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {mode === "search" && results.length > 0 && (
        <div className="mt-5 grid gap-3">
          {results.map((result) => (
            <Card key={result.citationId} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs crm-text-secondary">{result.categoryName}</p>
                  <h3 className="mt-1 font-semibold crm-text">{result.title}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="default">Version {result.versionNumber}</Badge>
                  <Badge variant="default">
                    {result.visibility === "restricted"
                      ? "Restricted"
                      : result.visibility === "owner"
                        ? "Owner"
                        : "Team"}
                  </Badge>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 crm-text-secondary">
                {result.snippet}
              </p>
              <Link
                href={`/knowledge/articles/${result.articleId}`}
                className="primary-button mt-4 inline-flex min-h-10 items-center rounded-xl px-3 py-2 text-sm text-white"
              >
                打开文章
              </Link>
            </Card>
          ))}
        </div>
      )}
      {mode === "search" && !busy && query.trim() && results.length === 0 && !error && (
        <div className="mt-4">
          <EmptyState message="目前没有找到符合条件的已发布 Knowledge。" />
        </div>
      )}
      {mode === "ask" && answer && (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="whitespace-pre-wrap break-words text-sm leading-7 crm-text">
            {answer.answer}
          </p>
          {answer.insufficientInformation && (
            <p className="mt-3 text-sm text-amber-800">
              以上内容仅反映目前已发布 Knowledge，现有资料可能不足。
            </p>
          )}
          {answer.citations.length > 0 && (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <p className="text-xs font-semibold crm-text-secondary">资料来源</p>
              <div className="mt-2 flex flex-col gap-2">
                {answer.citations.map((citation, index) => (
                  <Link
                    key={citation.citationId}
                    href={citation.href}
                    className="text-sm text-blue-700 underline"
                  >
                    [{index + 1}] {citation.title} · Version{" "}
                    {citation.versionNumber}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
