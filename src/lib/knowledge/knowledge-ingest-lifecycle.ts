import { KnowledgeApiClientError } from "@/lib/knowledge/error-messages";
import type {
  KnowledgeSourceLifecycle,
  KnowledgeSourceListItem,
} from "@/lib/knowledge/source-service";

export type KnowledgeSourcesListResponse = {
  sources?: KnowledgeSourceListItem[];
  error?: string;
  errorCode?: string;
};

export function buildKnowledgeSourcesListUrl(
  lifecycle: KnowledgeSourceLifecycle,
): string {
  return `/api/knowledge/sources?lifecycle=${lifecycle}`;
}

export function isKnowledgeIngestLifecycleAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function fetchKnowledgeSourcesForLifecycle(
  lifecycle: KnowledgeSourceLifecycle,
  signal?: AbortSignal,
): Promise<KnowledgeSourceListItem[]> {
  const response = await fetch(buildKnowledgeSourcesListUrl(lifecycle), {
    cache: "no-store",
    signal,
  });
  const payload = (await response.json()) as KnowledgeSourcesListResponse;
  if (!response.ok || !payload.sources) {
    throw new KnowledgeApiClientError(payload.errorCode);
  }
  return payload.sources;
}

export function createKnowledgeIngestLifecycleRequestGuard() {
  let currentRequestId = 0;
  return {
    begin(): number {
      currentRequestId += 1;
      return currentRequestId;
    },
    isCurrent(requestId: number): boolean {
      return requestId === currentRequestId;
    },
    current(): number {
      return currentRequestId;
    },
  };
}

export function filterSourcesForLifecycle(
  sources: KnowledgeSourceListItem[],
  lifecycle: KnowledgeSourceLifecycle,
): KnowledgeSourceListItem[] {
  return sources.filter((source) =>
    lifecycle === "archived"
      ? Boolean(source.archivedAt)
      : !source.archivedAt,
  );
}
