import { KnowledgeApiClientError } from "@/lib/knowledge/error-messages";
import type { KnowledgeComparisonDetail } from "@/lib/knowledge/comparison-types";

export type KnowledgeComparisonResponse = {
  comparison?: KnowledgeComparisonDetail | null;
  error?: string;
  errorCode?: string;
};

export function isKnowledgeComparisonAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function fetchKnowledgeComparison(
  sourceId: string,
  signal?: AbortSignal,
): Promise<KnowledgeComparisonDetail | null> {
  const response = await fetch(`/api/knowledge/sources/${sourceId}/comparison`, {
    cache: "no-store",
    signal,
  });
  const payload = (await response.json()) as KnowledgeComparisonResponse;
  if (!response.ok) {
    throw new KnowledgeApiClientError(payload.errorCode);
  }
  return payload.comparison ?? null;
}

export async function triggerKnowledgeComparison(
  sourceId: string,
  signal?: AbortSignal,
): Promise<KnowledgeComparisonDetail> {
  const response = await fetch(`/api/knowledge/sources/${sourceId}/compare`, {
    method: "POST",
    signal,
  });
  const payload = (await response.json()) as KnowledgeComparisonResponse;
  if (!response.ok || !payload.comparison) {
    throw new KnowledgeApiClientError(payload.errorCode);
  }
  return payload.comparison;
}
