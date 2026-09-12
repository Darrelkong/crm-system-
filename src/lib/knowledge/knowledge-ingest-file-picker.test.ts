import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { LOCAL_AUTH_SIMULATION_FLAG } from "@/lib/auth/local-preview-auth-simulation";
import { isKnowledgePreviewFixturesEnabled } from "@/lib/knowledge/knowledge-preview-fixtures";

const ingestClientPath = new URL(
  "../../components/knowledge/knowledge-ingest-client.tsx",
  import.meta.url,
);
const ingestPagePath = new URL(
  "../../app/(dashboard)/knowledge/ingest/page.tsx",
  import.meta.url,
);

function readSource(path: URL): string {
  return readFileSync(path, "utf8");
}

describe("Knowledge ingest file upload UI", () => {
  const source = readSource(ingestClientPath);

  it("keeps a hidden native file input behind styled controls", () => {
    assert.match(source, /type="file"/);
    assert.match(source, /className="sr-only"/);
    assert.match(source, /accept="\.txt,\.md,\.pdf,\.docx"/);
    assert.match(source, /fileInputRef\.current\?\.click\(\)/);
    assert.doesNotMatch(source, /no file selected/i);
    assert.doesNotMatch(source, />Choose File</);
  });

  it("renders an empty upload card with choose-file CTA", () => {
    assert.match(source, /data-upload-empty="true"/);
    assert.match(source, /uploadEmptyTitle/);
    assert.match(source, /uploadEmptySubtitle/);
    assert.match(source, /uploadFormatsLine/);
    assert.match(source, /chooseFileButton/);
  });

  it("renders a selected file summary card with metadata and actions", () => {
    assert.match(source, /data-upload-selected="true"/);
    assert.match(source, /data-selected-filename="true"/);
    assert.match(source, /data-selected-meta="true"/);
    assert.match(source, /formatFileTypeLabel/);
    assert.match(source, /formatSelectedFileSize/);
    assert.match(source, /replaceFile/);
    assert.match(source, /removeFile/);
    assert.match(source, /data-replace-file="true"/);
    assert.match(source, /data-remove-file="true"/);
    assert.match(source, /truncate/);
  });

  it("disables the primary CTA until a file is selected", () => {
    assert.match(source, /disabled=\{busy \|\| \(tab === "file" && !file\)\}/);
    assert.match(source, /creatingSource/);
  });

  it("shows upload and reading phases inside the upload panel", () => {
    assert.match(source, /data-upload-phase=\{uploadPhase\}/);
    assert.match(source, /uploadingFile/);
    assert.match(source, /readingFileContent/);
    assert.match(source, /Loader2/);
  });

  it("resets the picker and highlights the new source after success", () => {
    assert.match(source, /sourceCreatedSuccess/);
    assert.match(source, /data-upload-success-toast="true"/);
    assert.match(source, /setHighlightedSourceId/);
    assert.match(source, /clearSelectedFile/);
    assert.match(source, /scrollIntoView/);
  });

  it("uses amber duplicate notices inside the upload panel", () => {
    assert.match(source, /data-duplicate-notice="true"/);
    assert.match(source, /duplicateDetected/);
    assert.match(source, /duplicateActiveMessage/);
    assert.match(source, /duplicateArchivedMessage/);
    assert.match(source, /viewExistingSource/);
    assert.match(source, /goToArchivedSources/);
  });

  it("uses warning styling for scanned PDF and extraction failures", () => {
    assert.match(source, /scannedPdfListLabel/);
    assert.match(source, /extractionFailedListLabel/);
    assert.match(source, /data-extraction-notice="true"/);
    assert.match(source, /variant=\{statusTone === "warning"/);
  });

  it("shows richer file metadata in source list cards", () => {
    assert.match(source, /buildFileSourceMetaLine/);
    assert.match(source, /textSourceLabel/);
    assert.match(source, /data-source-id=\{source\.id\}/);
  });

  it("only exposes the preview fixture helper behind the local preview flag", () => {
    const pageSource = readSource(ingestPagePath);
    assert.match(pageSource, /isKnowledgePreviewFixturesEnabled/);
    assert.match(pageSource, /previewFixturesEnabled=/);
    assert.match(source, /previewFixturesEnabled/);
    assert.match(source, /data-preview-fixtures-link="true"/);
    assert.equal(
      isKnowledgePreviewFixturesEnabled({
        NODE_ENV: "production",
        [LOCAL_AUTH_SIMULATION_FLAG]: "true",
      }),
      false,
    );
    assert.equal(
      isKnowledgePreviewFixturesEnabled({
        NODE_ENV: "development",
        [LOCAL_AUTH_SIMULATION_FLAG]: "true",
      }),
      true,
    );
  });
});
