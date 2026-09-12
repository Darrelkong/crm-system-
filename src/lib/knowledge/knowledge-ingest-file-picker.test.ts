import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Knowledge ingest file picker UI", () => {
  it("keeps a hidden native file input behind a styled choose-file control", () => {
    const source = readFileSync(
      new URL("../../components/knowledge/knowledge-ingest-client.tsx", import.meta.url),
      "utf8",
    );
    assert.match(source, /type="file"/);
    assert.match(source, /className="sr-only"/);
    assert.match(source, /chooseFileButton/);
    assert.match(source, /noFileSelected/);
    assert.match(source, /formatSelectedFileSize/);
    assert.match(source, /accept="\.txt,\.md,\.pdf,\.docx"/);
    assert.match(source, /fileInputRef\.current\?\.click\(\)/);
    assert.match(source, /previewFixturesEnabled/);
    assert.match(source, /getTestFixtures/);
  });

  it("only exposes the preview fixture helper behind the local preview flag", () => {
    const pageSource = readFileSync(
      new URL("../../app/(dashboard)/knowledge/ingest/page.tsx", import.meta.url),
      "utf8",
    );
    assert.match(pageSource, /isKnowledgePreviewFixturesEnabled/);
    assert.match(pageSource, /previewFixturesEnabled=/);
  });
});
