/**
 * Fetch lifecycle for Admin AI Effect Stats — one GET, abort + sequence guard.
 */

import {
  buildAiEffectStatsUrl,
  type AiEffectStatsClientFilters,
} from "@/components/admin/ai-effect-stats/ai-effect-stats-filters";
import {
  parseAiEffectStatsClientResponse,
  AiEffectStatsParseError,
  type AiEffectStatsClientResponse,
} from "@/components/admin/ai-effect-stats/parse-ai-effect-stats-response";

export type AiEffectStatsFetchErrorKind =
  | "auth"
  | "data_limit"
  | "generic"
  | "malformed";

export type AiEffectStatsFetchResult =
  | { ok: true; data: AiEffectStatsClientResponse }
  | {
      ok: false;
      kind: AiEffectStatsFetchErrorKind;
      status: number | null;
      aborted: boolean;
    };

export async function fetchAiEffectStats(
  filters: AiEffectStatsClientFilters,
  options: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<AiEffectStatsFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildAiEffectStatsUrl(filters);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      credentials: "same-origin",
      signal: options.signal,
      headers: { Accept: "application/json" },
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        kind: "auth",
        status: response.status,
        aborted: false,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        ok: false,
        kind: "malformed",
        status: response.status,
        aborted: false,
      };
    }

    if (response.status === 503) {
      const code =
        body &&
        typeof body === "object" &&
        "code" in body &&
        typeof (body as { code: unknown }).code === "string"
          ? (body as { code: string }).code
          : null;
      if (code === "AI_EFFECT_STATS_DATA_LIMIT_EXCEEDED") {
        return {
          ok: false,
          kind: "data_limit",
          status: 503,
          aborted: false,
        };
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        kind: "generic",
        status: response.status,
        aborted: false,
      };
    }

    try {
      const data = parseAiEffectStatsClientResponse(body);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof AiEffectStatsParseError) {
        return {
          ok: false,
          kind: "malformed",
          status: response.status,
          aborted: false,
        };
      }
      throw err;
    }
  } catch (err) {
    if (
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      return {
        ok: false,
        kind: "generic",
        status: null,
        aborted: true,
      };
    }
    return {
      ok: false,
      kind: "generic",
      status: null,
      aborted: false,
    };
  }
}

/** Sequence-guarded loader for React components (no setState after unmount / stale). */
export function createAiEffectStatsSequenceGuard() {
  let sequence = 0;
  let controller: AbortController | null = null;

  return {
    begin(): { sequence: number; signal: AbortSignal } {
      sequence += 1;
      controller?.abort();
      controller = new AbortController();
      return { sequence, signal: controller.signal };
    },
    isCurrent(seq: number): boolean {
      return seq === sequence;
    },
    abort(): void {
      controller?.abort();
      controller = null;
      sequence += 1;
    },
  };
}
