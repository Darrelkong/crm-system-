import { fetchComposeContext } from "@/lib/mail/client/api";
import type { ComposeContextOption } from "@/lib/mail/client/draft-management";

type ComposeContextCacheEntry = {
  options: ComposeContextOption[] | null;
  inflight: Promise<ComposeContextOption[] | null> | null;
  fetchGeneration: number;
};

const cacheByActorUserId = new Map<string, ComposeContextCacheEntry>();

function normalizeActorUserId(
  actorUserId: string | null | undefined,
): string | null {
  const normalized = actorUserId?.trim();
  return normalized ? normalized : null;
}

function getOrCreateEntry(actorUserId: string): ComposeContextCacheEntry {
  const existing = cacheByActorUserId.get(actorUserId);
  if (existing) {
    return existing;
  }
  const entry: ComposeContextCacheEntry = {
    options: null,
    inflight: null,
    fetchGeneration: 0,
  };
  cacheByActorUserId.set(actorUserId, entry);
  return entry;
}

function invalidateInFlightEntries(): void {
  for (const entry of cacheByActorUserId.values()) {
    entry.fetchGeneration += 1;
    entry.inflight = null;
  }
}

export function getCachedComposeContext(
  actorUserId: string | null | undefined,
): ComposeContextOption[] | null {
  const userId = normalizeActorUserId(actorUserId);
  if (!userId) {
    return null;
  }
  return cacheByActorUserId.get(userId)?.options ?? null;
}

export function setCachedComposeContext(
  actorUserId: string,
  options: ComposeContextOption[],
): void {
  const userId = normalizeActorUserId(actorUserId);
  if (!userId) {
    return;
  }
  const entry = getOrCreateEntry(userId);
  entry.options = options;
}

export function prefetchComposeContext(
  actorUserId: string | null | undefined,
): Promise<ComposeContextOption[] | null> {
  const userId = normalizeActorUserId(actorUserId);
  if (!userId) {
    return Promise.resolve(null);
  }

  const entry = getOrCreateEntry(userId);
  if (entry.options) {
    return Promise.resolve(entry.options);
  }
  if (entry.inflight) {
    return entry.inflight;
  }

  const generation = ++entry.fetchGeneration;
  entry.inflight = fetchComposeContext()
    .then((result) => {
      const current = cacheByActorUserId.get(userId);
      if (!current || current.fetchGeneration !== generation) {
        return null;
      }
      if (!result.ok) {
        return null;
      }
      current.options = result.items;
      return result.items;
    })
    .finally(() => {
      const current = cacheByActorUserId.get(userId);
      if (current && current.fetchGeneration === generation) {
        current.inflight = null;
      }
    });

  return entry.inflight;
}

export function clearComposeContextCache(): void {
  invalidateInFlightEntries();
  cacheByActorUserId.clear();
}

export function clearComposeContextCacheForActor(
  actorUserId: string | null | undefined,
): void {
  const userId = normalizeActorUserId(actorUserId);
  if (!userId) {
    clearComposeContextCache();
    return;
  }
  const entry = cacheByActorUserId.get(userId);
  if (entry) {
    entry.fetchGeneration += 1;
    entry.inflight = null;
    cacheByActorUserId.delete(userId);
  }
}

export function invalidateComposeContextCache(): void {
  clearComposeContextCache();
}

export function clearComposeContextCacheOnSessionEnd(): void {
  clearComposeContextCache();
}
