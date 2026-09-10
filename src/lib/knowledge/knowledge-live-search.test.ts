import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it, mock } from "node:test";
import { join } from "node:path";
import {
  buildKnowledgeSearchUrl,
  fetchKnowledgeSearchResults,
  isLiveKnowledgeSearchAbortError,
  KNOWLEDGE_LIVE_SEARCH_DEBOUNCE_MS,
  shouldSkipLiveKnowledgeSearch,
} from "@/lib/knowledge/knowledge-live-search";

const panelSource = readFileSync(
  join(process.cwd(), "src/components/knowledge/knowledge-search-ai-panel.tsx"),
  "utf8",
);

describe("Knowledge live search helpers", () => {
  it("uses a 300ms debounce constant", () => {
    assert.equal(KNOWLEDGE_LIVE_SEARCH_DEBOUNCE_MS, 300);
  });

  it("builds the published search API URL", () => {
    const url = buildKnowledgeSearchUrl("开户目的");
    assert.match(url, /^\/api\/knowledge\/search\?q=/);
    assert.equal(decodeURIComponent(url.split("q=")[1] ?? ""), "开户目的");
  });

  it("skips live search while composing or when query is empty", () => {
    assert.equal(shouldSkipLiveKnowledgeSearch("", false), true);
    assert.equal(shouldSkipLiveKnowledgeSearch("开户目的", true), true);
    assert.equal(shouldSkipLiveKnowledgeSearch("开户目的", false), false);
  });

  it("treats AbortError as non-fatal", () => {
    assert.equal(
      isLiveKnowledgeSearchAbortError(new DOMException("aborted", "AbortError")),
      true,
    );
    assert.equal(isLiveKnowledgeSearchAbortError(new Error("aborted")), false);
  });
});

describe("Knowledge live search fetch", () => {
  const originalFetch = globalThis.fetch;

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns search results from the API", async () => {
    globalThis.fetch = mock.fn(async () =>
      Response.json({
        results: [
          {
            articleId: "article-1",
            versionNumber: 4,
            citationId: "article-1:4",
            title: "海外銀行帳戶服務",
            summary: null,
            snippet: "開戶目的",
            categoryId: "category-1",
            categoryName: "流程",
            visibility: "team",
            ownerUserId: null,
          },
        ],
      }),
    ) as typeof fetch;

    const results = await fetchKnowledgeSearchResults("开户目的");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.title, "海外銀行帳戶服務");
  });

  it("ignores aborted search requests without surfacing an error", async () => {
    globalThis.fetch = mock.fn(async (_input, init) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (init?.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return Response.json({ results: [] });
    }) as typeof fetch;

    const controller = new AbortController();
    const pending = fetchKnowledgeSearchResults("开户目的", controller.signal);
    controller.abort();
    await assert.rejects(pending, (error: unknown) => {
      assert.equal(isLiveKnowledgeSearchAbortError(error), true);
      return true;
    });
  });
});

describe("Knowledge live search panel wiring", () => {
  it("searches automatically while typing without a visible Search button", () => {
    assert.match(panelSource, /KNOWLEDGE_LIVE_SEARCH_DEBOUNCE_MS/);
    assert.match(panelSource, /fetchKnowledgeSearchResults/);
    assert.match(panelSource, /AbortController/);
    assert.match(panelSource, /onCompositionStart/);
    assert.match(panelSource, /onCompositionEnd/);
    assert.match(panelSource, /knowledge\.searchAi\.searching/);
    assert.match(panelSource, /mode === "ask" &&/);
    assert.match(panelSource, /knowledge\.searchAi\.askButton/);
    assert.match(panelSource, /\{mode === "ask" && \([\s\S]*type="submit"/);
    assert.doesNotMatch(panelSource, /\{mode === "search" && \([\s\S]*type="submit"/);
    assert.doesNotMatch(panelSource, /setInterval/);
  });

  it("keeps Ask mode explicit and does not auto-submit AI while typing", () => {
    const submitAskBlock =
      panelSource.match(/async function submitAsk[\s\S]*?\n  \}/)?.[0] ?? "";
    assert.match(panelSource, /onSubmit={mode === "ask" \? submitAsk : onSearchSubmit}/);
    assert.match(panelSource, /mode !== "search" \|\| composingRef\.current \|\| query\.trim\(\) === ""/);
    assert.doesNotMatch(submitAskBlock, /scheduleLiveSearch/);
    assert.doesNotMatch(submitAskBlock, /runLiveSearch/);
  });
});
