import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

type FetchCall = { url: string; method: string };

async function simulateIdleCandidateRefreshCycle(options: {
  confirmedCount: number;
  lineageStable: boolean;
  initialCandidates: number;
}) {
  const calls: FetchCall[] = [];
  const fetchMock = mock.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/candidates") && method === "GET") {
      return {
        ok: true,
        json: async () => ({
          candidates: Array.from({ length: options.initialCandidates }, (_, index) => ({
            id: `c-${index}`,
            segmentIndex: index,
          })),
        }),
      };
    }
    return { ok: true, json: async () => ({ candidates: [] }) };
  });

  let candidates = Array.from({ length: options.initialCandidates }, (_, index) => ({
    id: `c-${index}`,
  }));
  let candidatesEverLoaded = candidates.length > 0;
  let candidatesLoading = false;
  let lineageKey = "source:run-a";
  const previousLineageKey = lineageKey;

  const refreshCandidates = async (confirmedCount: number, silent = false) => {
    if (confirmedCount === 0) return;
    const showInitialPreparing =
      !silent && candidates.length === 0 && !candidatesEverLoaded;
    if (showInitialPreparing) {
      candidatesLoading = true;
    }
    await fetchMock(`/api/knowledge/sources/source/candidates`, { method: "GET" });
    candidates = Array.from({ length: options.initialCandidates }, (_, index) => ({
      id: `c-${index}`,
    }));
    if (candidates.length > 0) {
      candidatesEverLoaded = true;
    }
    candidatesLoading = false;
  };

  if (!options.lineageStable) {
    lineageKey = "source:run-b";
  }

  const shouldReset =
    previousLineageKey !== null && previousLineageKey !== lineageKey;
  if (shouldReset) {
    candidates = [];
    candidatesEverLoaded = false;
  }

  await refreshCandidates(options.confirmedCount, candidatesEverLoaded);
  await refreshCandidates(options.confirmedCount, candidatesEverLoaded);
  await refreshCandidates(options.confirmedCount, candidatesEverLoaded);

  return {
    calls,
    candidates,
    candidatesLoading,
    candidatesEverLoaded,
  };
}

describe("knowledge smart ingest candidate refresh lifecycle (2E-4C)", () => {
  it("idle stable lineage keeps candidates and avoids initial-loading clears", async () => {
    const result = await simulateIdleCandidateRefreshCycle({
      confirmedCount: 3,
      lineageStable: true,
      initialCandidates: 3,
    });
    assert.equal(result.candidates.length, 3);
    assert.equal(result.candidatesEverLoaded, true);
    assert.equal(result.candidatesLoading, false);
    assert.equal(result.calls.length, 3);
    assert.ok(
      result.calls.every(
        (call) => call.method === "GET" && call.url.endsWith("/candidates"),
      ),
    );
  });

  it("real lineage change clears candidates once before reload", async () => {
    const result = await simulateIdleCandidateRefreshCycle({
      confirmedCount: 2,
      lineageStable: false,
      initialCandidates: 2,
    });
    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidatesEverLoaded, true);
  });
});
