import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import { deriveSmartIngestSourceScope } from "@/lib/knowledge/smart-ingest-source-scope";

const root = process.cwd();
const ingest = readFileSync(
  join(root, "src/components/knowledge/knowledge-ingest-client.tsx"),
  "utf8",
);
const analysis = readFileSync(
  join(root, "src/components/knowledge/knowledge-smart-ingest-analysis-section.tsx"),
  "utf8",
);

describe("knowledge ingest human review UX", () => {
  it("A: create submit is single-fire with immediate busy label", () => {
    assert.match(ingest, /createSubmitLockRef/);
    assert.match(ingest, /setCreatingSource\(true\)/);
    assert.match(ingest, /creatingSourceBusy/);
    assert.match(ingest, /data-create-source-submit/);
    assert.match(ingest, /disabled=\{[^}]*creatingSource/);
  });

  it("B/C/D: successful paste uses flushSync close then loadSource", () => {
    assert.match(ingest, /completePasteSourceTransition/);
    assert.match(ingest, /flushSync/);
    assert.match(ingest, /setCreateFormOpen\(false\)/);
    assert.match(ingest, /await loadSource\(sourceId\)/);
    assert.match(ingest, /sourceEstablished/);
  });

  it("E: duplicate paste closes drawer and opens existing source", () => {
    assert.match(ingest, /pasteDuplicateOpenedExisting/);
    assert.match(ingest, /completePasteSourceTransition\(\s*payload\.duplicate\.id/);
  });

  it("F: newly analyzed segments start as proposed in service", () => {
    const service = readFileSync(
      join(root, "src/lib/knowledge/smart-ingest-analysis-service.ts"),
      "utf8",
    );
    assert.match(service, /status: "proposed" as const/);
  });

  it("G/H: segment keep/reject map to confirmed and rejected", () => {
    assert.match(analysis, /updateSegmentStatus\(segment\.id, "confirmed"\)/);
    assert.match(analysis, /updateSegmentStatus\(segment\.id, "rejected"\)/);
    assert.match(analysis, /segmentKept/);
    assert.match(analysis, /segmentRejected/);
  });

  it("I: confirm all proposed segments", () => {
    assert.match(analysis, /confirmAllProposedSegments/);
    assert.match(analysis, /data-segment-confirm-all/);
    assert.match(analysis, /segmentConfirmAll/);
  });

  it("J: confirmed cards are visually distinct", () => {
    assert.match(analysis, /border-emerald-200/);
    assert.match(analysis, /data-segment-status=\{segment\.status\}/);
  });

  it("K: multi-topic organizer blocked after confirmations", () => {
    const scope = deriveSmartIngestSourceScope({
      analysisStatus: "ready_for_review",
      latestAnalysisRunId: "run",
      segments: [0, 1, 2].map((index) => ({
        id: String(index),
        segmentIndex: index,
        titleHint: `T${index}`,
        evidenceText: `Body ${index}`,
        evidenceStart: index,
        evidenceEnd: index + 1,
        status: "confirmed" as const,
      })),
    });
    assert.equal(scope.blocksSourceLevelOrganize, true);
  });

  it("L: re-analysis supersedes confirmed and rejected prior segments", () => {
    const service = readFileSync(
      join(root, "src/lib/knowledge/smart-ingest-analysis-service.ts"),
      "utf8",
    );
    // 1B-A moved supersession into the guarded analysis-start batch.
    const start = service.slice(service.indexOf("export async function startKnowledgeSourceAnalysis"),
      service.indexOf("export async function", service.indexOf("export async function startKnowledgeSourceAnalysis") + 1));
    assert.match(start, /await db\.batch\(\[/);
    assert.match(start, /db\.update\(schema\.knowledgeSourceSegments\)\.set\(\{ status: "superseded" \}\)/);
    assert.match(start, /inArray\(schema\.knowledgeSourceSegments\.status, \["proposed", "confirmed", "rejected"\]\), created/);
  });

  it("M: human review strings exist in locales", () => {
    assert.ok(zhHans.knowledge.ingest.segmentKept);
    assert.ok(en.knowledge.ingest.segmentConfirmAll);
    assert.doesNotMatch(zhHans.knowledge.ingest.segmentKept, /knowledge\.ingest/);
  });

  it("mobile sheet is not tied to detail-mode mount only", () => {
    const sheetIndex = ingest.indexOf("<KnowledgeMobileSheet");
    const detailGate = ingest.indexOf("!inDetailMode && !isArchivedView");
    const sheetBlock = ingest.slice(sheetIndex - 80, sheetIndex + 40);
    assert.ok(sheetIndex > detailGate);
  });
});
