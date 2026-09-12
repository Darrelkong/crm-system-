import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  KNOWLEDGE_COMPARISON_CLIENT_TIMEOUT_MS,
  isKnowledgeComparisonClientTimeoutError,
  KnowledgeComparisonClientTimeoutError,
} from "@/lib/knowledge/knowledge-comparison-orchestration";

const root = process.cwd();

describe("knowledge ingest mobile flow", () => {
  it("enters source detail mode and hides create form when a source is selected", () => {
    const ingest = readFileSync(
      join(root, "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    assert.match(ingest, /data-ingest-layout=\{inDetailMode \? "detail" : "list"\}/);
    assert.match(ingest, /data-create-source-panel="true"/);
    assert.match(ingest, /createFormOpen &&/);
    assert.match(ingest, /data-source-detail="true"/);
    assert.match(ingest, /data-back-to-source-list="true"/);
    assert.doesNotMatch(
      ingest,
      /\{selected && \(\s*<Card>\s*<div className="flex flex-wrap items-center justify-between gap-3">/,
    );
  });

  it("uses step headers, advisory organizer warnings, and reorganize action", () => {
    const ingest = readFileSync(
      join(root, "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    assert.match(ingest, /KnowledgeIngestStepHeader/);
    assert.match(ingest, /data-ingest-step="organize"/);
    assert.match(ingest, /data-organizer-advisory="true"/);
    assert.match(ingest, /knowledge\.ingest\.reorganize/);
    assert.match(ingest, /data-organize-button="true"/);
    assert.match(ingest, /data-ingest-step="comparison"/);
    assert.match(ingest, /data-ingest-step="draft"/);
    assert.match(ingest, /draftPendingComparisonHint/);
  });

  it("scrolls selected source detail into view", () => {
    const ingest = readFileSync(
      join(root, "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    assert.match(ingest, /detailHeaderRef/);
    assert.match(ingest, /scrollDetailIntoView/);
  });

  it("styles archive as an outline secondary action", () => {
    const archive = readFileSync(
      join(root, "src/components/knowledge/knowledge-source-archive-button.tsx"),
      "utf8",
    );
    assert.match(archive, /data-archive-source-button="true"/);
    assert.match(archive, /variant="secondary"/);
  });
});

describe("knowledge comparison client timeout", () => {
  it("uses a 30 second bounded wait", () => {
    assert.equal(KNOWLEDGE_COMPARISON_CLIENT_TIMEOUT_MS, 30_000);
  });

  it("identifies client timeout errors", () => {
    assert.equal(
      isKnowledgeComparisonClientTimeoutError(
        new KnowledgeComparisonClientTimeoutError(),
      ),
      true,
    );
  });
});
