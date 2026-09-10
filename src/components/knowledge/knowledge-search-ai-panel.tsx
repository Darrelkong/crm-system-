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
  fetchKnowledgeSearchResults,
  isLiveKnowledgeSearchAbortError,
  KNOWLEDGE_LIVE_SEARCH_DEBOUNCE_MS,
  shouldSkipLiveKnowledgeSearch,
} from "@/lib/knowledge/knowledge-live-search";

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
        caught instanceof Error
          ? caught.message
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
      };
      if (!response.ok || !payload.answer) {
        throw new Error(
          payload.error ?? t("knowledge.searchAi.providerUnavailable"),
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
    <Card className="border-blue-100 bg-blue-50/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "search" ? "primary" : "secondary"}
          onClick={() => {
            setMode("search");
            setAnswer(null);
            setError(null);
          }}
        >
          {t("knowledge.searchAi.search")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "ask" ? "primary" : "secondary"}
          onClick={() => {
            setMode("ask");
            resetSearchState();
            setAnswer(null);
            setError(null);
          }}
        >
          {t("knowledge.searchAi.ask")}
        </Button>
      </div>
      <form
        className="mt-3 flex flex-col gap-3 sm:mt-4 sm:flex-row"
        onSubmit={mode === "ask" ? submitAsk : onSearchSubmit}
      >
        {mode === "ask" ? (
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("knowledge.searchAi.askPlaceholder")}
            aria-label={t("knowledge.searchAi.ask")}
            maxLength={200}
            rows={3}
            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
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
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm"
          />
        )}
        {mode === "ask" && (
          <Button type="submit" className="min-h-11" disabled={askBusy || !query.trim()}>
            {askBusy
              ? t("knowledge.searchAi.processing")
              : t("knowledge.searchAi.askButton")}
          </Button>
        )}
      </form>
      {mode === "search" && searchBusy && (
        <p className="mt-3 text-sm crm-text-secondary">
          {t("knowledge.searchAi.searching")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {mode === "search" && results.length > 0 && (
        <div className="mt-4 grid gap-3 sm:mt-5">
          {results.map((result) => (
            <Card key={result.citationId} className="p-3 sm:p-4">
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
                {t("knowledge.searchAi.openArticle")}
              </Link>
            </Card>
          ))}
        </div>
      )}
      {mode === "search" && !searchBusy && query.trim() && results.length === 0 && !error && (
        <div className="mt-4">
          <EmptyState message={t("knowledge.searchAi.noResults")} />
        </div>
      )}
      {mode === "ask" && answer && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 sm:mt-5">
          <p className="whitespace-pre-wrap break-words text-sm leading-7 crm-text">
            {answer.answer}
          </p>
          {answer.insufficientInformation && (
            <p className="mt-3 text-sm text-amber-800">
              {t("knowledge.searchAi.insufficientAnswer")}
            </p>
          )}
          {answer.citations.length > 0 && (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <p className="text-xs font-semibold crm-text-secondary">
                {t("knowledge.searchAi.sources")}
              </p>
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
