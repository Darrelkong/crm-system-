import type { KnowledgeSearchResult } from "@/lib/knowledge/published-retrieval";

export const KNOWLEDGE_LIVE_SEARCH_DEBOUNCE_MS = 300;

export function buildKnowledgeSearchUrl(query: string): string {
  return `/api/knowledge/search?q=${encodeURIComponent(query)}`;
}

export function shouldSkipLiveKnowledgeSearch(
  query: string,
  composing: boolean,
): boolean {
  return composing || query.trim().length === 0;
}

export function isLiveKnowledgeSearchAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export type KnowledgeSearchResponse = {
  results?: KnowledgeSearchResult[];
  error?: string;
};

export async function fetchKnowledgeSearchResults(
  query: string,
  signal?: AbortSignal,
): Promise<KnowledgeSearchResult[]> {
  const response = await fetch(buildKnowledgeSearchUrl(query), {
    cache: "no-store",
    signal,
  });
  const payload = (await response.json()) as KnowledgeSearchResponse;
  if (!response.ok || !payload.results) {
    throw new Error(payload.error ?? "搜索失败");
  }
  return payload.results;
}
