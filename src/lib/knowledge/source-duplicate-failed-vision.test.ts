import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  isFailedVisionImageDuplicate,
  type KnowledgeSourceDuplicateSummary,
} from "@/lib/knowledge/source-duplicate";

const ingestClientPath = new URL(
  "../../components/knowledge/knowledge-ingest-client.tsx",
  import.meta.url,
);

function duplicateSummary(
  overrides: Partial<KnowledgeSourceDuplicateSummary> = {},
): KnowledgeSourceDuplicateSummary {
  return {
    id: "source-1",
    sourceTitle: null,
    originalFilename: "p2c-b1-table.png",
    status: "failed",
    lifecycle: "active",
    createdAt: "2026-09-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("failed vision duplicate semantics", () => {
  it("identifies failed active image duplicates", () => {
    assert.equal(isFailedVisionImageDuplicate(duplicateSummary()), true);
    assert.equal(
      isFailedVisionImageDuplicate(
        duplicateSummary({ status: "ready", lifecycle: "active" }),
      ),
      false,
    );
    assert.equal(
      isFailedVisionImageDuplicate(
        duplicateSummary({ lifecycle: "archived", status: "failed" }),
      ),
      false,
    );
    assert.equal(
      isFailedVisionImageDuplicate(
        duplicateSummary({ originalFilename: "notes.pdf", status: "failed" }),
      ),
      false,
    );
  });

  it("uses failed-specific ingest duplicate copy in the client", () => {
    const source = readFileSync(ingestClientPath, "utf8");
    assert.match(source, /duplicateFailedDetected/);
    assert.match(source, /duplicateFailedMessage/);
    assert.match(source, /viewFailedSource/);
    assert.match(source, /retryImageExtraction/);
    assert.match(source, /data-duplicate-kind/);
    assert.match(source, /failed-vision/);
    assert.doesNotMatch(
      source,
      /isFailedVisionDuplicateNotice\(duplicateNotice\)[\s\S]{0,200}duplicateActiveMessage/,
    );
  });
});
