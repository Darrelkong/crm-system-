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
  it("shows only the new-source action without duplicating the source-list title", () => {
    const ingest = readFileSync(
      join(root, "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    const listModeSection = ingest.slice(
      ingest.indexOf("data-new-source-action-row"),
      ingest.indexOf("data-create-source-panel"),
    );
    assert.doesNotMatch(listModeSection, /knowledge\.ingest\.sourceList/);
    assert.match(listModeSection, /knowledge\.ingest\.newSourceAction/);
  });

  it("keeps the new-source action row inside the content column on mobile", () => {
    const ingest = readFileSync(
      join(root, "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    const actionRowStart = ingest.indexOf('data-new-source-action-row="true"');
    const actionRow = ingest.slice(
      ingest.lastIndexOf("<div", actionRowStart),
      ingest.indexOf(">", actionRowStart) + 1,
    );
    assert.match(actionRow, /w-full/);
    assert.match(actionRow, /min-w-0/);
    assert.match(actionRow, /justify-end/);
    assert.doesNotMatch(actionRow, /w-screen/);
    assert.doesNotMatch(actionRow, /100vw/);
    assert.doesNotMatch(actionRow, /absolute/);
    assert.doesNotMatch(actionRow, /-mx-/);
    const buttonStart = ingest.indexOf('data-new-source-action="true"');
    const buttonSection = ingest.slice(
      ingest.lastIndexOf("<Button", buttonStart),
      buttonStart + 'data-new-source-action="true"'.length,
    );
    assert.match(buttonSection, /max-w-full shrink-0/);
    assert.match(ingest, /overflow-x-clip/);
    assert.match(ingest, /grid min-w-0 max-w-full/);
    assert.match(ingest, /<aside className="min-w-0/);
    assert.match(ingest, /<main className="min-w-0 max-w-full/);
  });

  it("renders source management without a numeric step prefix", () => {
    const ingest = readFileSync(
      join(root, "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    const managementSection = ingest.slice(
      ingest.indexOf('data-ingest-step="source-management"'),
      ingest.indexOf('data-ingest-step="source-management"') + 400,
    );
    assert.doesNotMatch(managementSection, /step=\{5\}/);
    assert.match(managementSection, /stepSourceManagement/);
  });

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
