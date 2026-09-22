import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

describe("knowledge ingest interaction", () => {
  it("gives source cards immediate loading feedback and pressed state", () => {
    const ingest = readFileSync(
      join(root, "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    assert.match(ingest, /loadingSourceId/);
    assert.match(ingest, /setLoadingSourceId\(sourceId\)/);
    assert.match(ingest, /active:scale-\[0\.99\]/);
    assert.match(ingest, /aria-busy=\{isLoading\}/);
    assert.match(ingest, /t\("common\.loading"\)/);
  });

  it("opens new-source panel with mobile sheet or desktop scroll on first tap", () => {
    const ingest = readFileSync(
      join(root, "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    assert.match(ingest, /openCreateSourcePanel/);
    assert.match(ingest, /createFormPanelRef/);
    assert.match(ingest, /scrollIntoView/);
    assert.match(ingest, /data-create-source-panel/);
    assert.match(ingest, /KnowledgeMobileSheet/);
    assert.match(ingest, /data-create-source-mobile-sheet/);
    assert.match(ingest, /isMobileViewport/);
  });

  it("handles failed, ready, and organized source clicks through loadSource", () => {
    const ingest = readFileSync(
      join(root, "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    assert.match(ingest, /onClick=\{\(\) => void loadSource\(source\.id\)\}/);
    assert.match(ingest, /catch \(caught\)/);
    assert.match(ingest, /sourceLoadRequestGuardRef/);
  });
});
