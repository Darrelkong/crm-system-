"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CompositionEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import type { KnowledgeAiAnswer } from "@/lib/knowledge/qa-service";
import type { KnowledgeSearchResult } from "@/lib/knowledge/published-retrieval";
import {
  getKnowledgeErrorMessage,
  KnowledgeApiClientError,
  resolveKnowledgeApiError,
} from "@/lib/knowledge/error-messages";
import {
  fetchKnowledgeSearchResults,
  isLiveKnowledgeSearchAbortError,
  KNOWLEDGE_LIVE_SEARCH_DEBOUNCE_MS,
  shouldSkipLiveKnowledgeSearch,
} from "@/lib/knowledge/knowledge-live-search";
import { cn } from "@/lib/cn";

type Mode = "search" | "ask";

export function KnowledgeSearchAiPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [answer, setAnswer] = useState<KnowledgeAiAnswer | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [askBusy, setAskBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);

  const clearSearchDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const cancelSearchRequest = useCallback(() => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
  }, []);

  const resetSearchState = useCallback(() => {
    clearSearchDebounce();
    cancelSearchRequest();
    setSearchBusy(false);
    setResults([]);
    setError(null);
  }, [cancelSearchRequest, clearSearchDebounce]);

  const runLiveSearch = useCallback(async (rawQuery: string) => {
    const value = rawQuery.trim();
    if (!value) {
      resetSearchState();
      return;
    }
    if (shouldSkipLiveKnowledgeSearch(value, composingRef.current)) {
      return;
    }

    clearSearchDebounce();
    cancelSearchRequest();

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchBusy(true);
    setError(null);
    setAnswer(null);

    try {
      const nextResults = await fetchKnowledgeSearchResults(value, controller.signal);
      if (requestId !== searchRequestIdRef.current) return;
      setResults(nextResults);
    } catch (caught) {
      if (requestId !== searchRequestIdRef.current) return;
      if (isLiveKnowledgeSearchAbortError(caught)) return;
      setError(
        caught instanceof KnowledgeApiClientError
          ? getKnowledgeErrorMessage(t, caught.errorCode)
          : t("knowledge.searchAi.requestFailed"),
      );
      setResults([]);
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setSearchBusy(false);
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null;
        }
      }
    }
  }, [cancelSearchRequest, clearSearchDebounce, resetSearchState, t]);

  const scheduleLiveSearch = useCallback(
    (rawQuery: string) => {
      clearSearchDebounce();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void runLiveSearch(rawQuery);
      }, KNOWLEDGE_LIVE_SEARCH_DEBOUNCE_MS);
    },
    [clearSearchDebounce, runLiveSearch],
  );

  useEffect(() => {
    if (mode !== "search" || composingRef.current || query.trim() === "") {
      return;
    }
    scheduleLiveSearch(query);
    return () => {
      clearSearchDebounce();
    };
  }, [clearSearchDebounce, mode, query, scheduleLiveSearch]);

  useEffect(() => {
    return () => {
      clearSearchDebounce();
      cancelSearchRequest();
    };
  }, [cancelSearchRequest, clearSearchDebounce]);

  const onSearchQueryChange = (value: string) => {
    setQuery(value);
    if (mode !== "search") return;
    if (value.trim() === "") {
      resetSearchState();
      return;
    }
    if (composingRef.current) return;
    scheduleLiveSearch(value);
  };

  const onCompositionStart = () => {
    composingRef.current = true;
    clearSearchDebounce();
    cancelSearchRequest();
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    const value = event.currentTarget.value;
    setQuery(value);
    if (mode !== "search") return;
    if (value.trim() === "") {
      resetSearchState();
      return;
    }
    scheduleLiveSearch(value);
  };

  async function submitAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value || askBusy) return;
    setAskBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const response = await fetch("/api/knowledge/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: value }),
      });
      const payload = (await response.json()) as {
        answer?: KnowledgeAiAnswer;
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.answer) {
        throw new Error(
          resolveKnowledgeApiError(
            t,
            payload,
            "knowledge.searchAi.providerUnavailable",
          ),
        );
      }
      setAnswer(payload.answer);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.searchAi.requestFailed"),
      );
    } finally {
      setAskBusy(false);
    }
  }

  function onSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode !== "search") return;
    clearSearchDebounce();
    void runLiveSearch(query);
  }

  return (
    <div className="space-y-2.5">
      <div
        className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-50 p-0.5"
        role="tablist"
        aria-label={t("knowledge.searchAi.modeLabel")}
      >
        {(["search", "ask"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={mode === tab}
            className={cn(
              "min-h-9 flex-1 rounded-md px-3 text-sm font-medium transition-colors",
              mode === tab
                ? "bg-white text-blue-700 shadow-sm"
                : "crm-text-secondary hover:text-slate-700",
            )}
            onClick={() => {
              setMode(tab);
              if (tab === "search") {
                setAnswer(null);
                setError(null);
              } else {
                resetSearchState();
                setAnswer(null);
                setError(null);
              }
            }}
          >
            {tab === "search"
              ? t("knowledge.searchAi.search")
              : t("knowledge.searchAi.ask")}
          </button>
        ))}
      </div>

      <form
        className="space-y-2"
        onSubmit={mode === "ask" ? submitAsk : onSearchSubmit}
      >
        {mode === "ask" ? (
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("knowledge.searchAi.askPlaceholder")}
            aria-label={t("knowledge.searchAi.ask")}
            maxLength={200}
            rows={2}
            className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        ) : (
          <input
            value={query}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder={t("knowledge.searchAi.searchPlaceholder")}
            aria-label={t("knowledge.searchAi.search")}
            maxLength={200}
            className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
        )}
        {mode === "ask" && (
          <Button
            type="submit"
            size="sm"
            className="min-h-10 w-full sm:w-auto"
            disabled={askBusy || !query.trim()}
          >
            {askBusy
              ? t("knowledge.searchAi.processing")
              : t("knowledge.searchAi.askButton")}
          </Button>
        )}
      </form>

      {mode === "search" && searchBusy && (
        <p className="text-xs crm-text-secondary">
          {t("knowledge.searchAi.searching")}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {mode === "search" && results.length > 0 && (
        <div className="grid gap-2 pt-1">
          {results.map((result) => (
            <Card key={result.citationId} className="p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs crm-text-secondary">{result.categoryName}</p>
                  <h3 className="mt-0.5 font-semibold crm-text">{result.title}</h3>
                </div>
                <div className="flex flex-wrap gap-1.5">
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
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 crm-text-secondary">
                {result.snippet}
              </p>
              <Link
                href={`/knowledge/articles/${result.articleId}`}
                className="primary-button mt-3 inline-flex min-h-9 items-center rounded-lg px-3 py-1.5 text-sm text-white"
              >
                {t("knowledge.searchAi.openArticle")}
              </Link>
            </Card>
          ))}
        </div>
      )}
      {mode === "search" && !searchBusy && query.trim() && results.length === 0 && !error && (
        <EmptyState message={t("knowledge.searchAi.noResults")} />
      )}
      {mode === "ask" && answer && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="whitespace-pre-wrap break-words text-sm leading-7 crm-text">
            {answer.answer}
          </p>
          {answer.insufficientInformation && (
            <p className="mt-2 text-sm text-amber-800">
              {t("knowledge.searchAi.insufficientAnswer")}
            </p>
          )}
          {answer.citations.length > 0 && (
            <div className="mt-4 border-t border-slate-200 pt-3">
              <p className="text-xs font-semibold crm-text-secondary">
                {t("knowledge.searchAi.sources")}
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
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
    </div>
  );
}
