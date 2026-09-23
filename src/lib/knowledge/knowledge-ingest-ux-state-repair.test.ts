import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import {
  deriveSmartIngestSourceScope,
  countRetainedProposedSegments,
} from "@/lib/knowledge/smart-ingest-source-scope";
import { getKnowledgeErrorMessage } from "@/lib/knowledge/error-messages";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";

const root = process.cwd();
const ingestPath = join(
  root,
  "src/components/knowledge/knowledge-ingest-client.tsx",
);
const analysisPath = join(
  root,
  "src/components/knowledge/knowledge-smart-ingest-analysis-section.tsx",
);

describe("knowledge ingest UX state repair", () => {
  const ingest = readFileSync(ingestPath, "utf8");
  const analysis = readFileSync(analysisPath, "utf8");

  it("A: new paste submit closes drawer, selects source, and scrolls detail", () => {
    assert.match(ingest, /setCreateFormOpen\(false\)/);
    assert.match(ingest, /setSelected\(createdSource\)/);
    assert.match(ingest, /scrollDetailIntoView\(\)/);
    assert.match(ingest, /tab === "paste"/);
    assert.match(ingest, /submittingPaste/);
  });

  it("B/C: exact duplicate paste auto-opens existing source without new row", () => {
    assert.match(ingest, /SOURCE_DUPLICATE/);
    assert.match(ingest, /pasteDuplicateOpenedExisting/);
    assert.match(ingest, /openDuplicateSource\(\s*payload\.duplicate\.id/);
    assert.match(ingest, /tab === "paste"/);
  });

  it("D: analyze click sets immediate analyzing state via flushSync", () => {
    assert.match(analysis, /flushSync/);
    assert.match(analysis, /setAnalyzing\(true\)/);
    assert.match(analysis, /analyzingContent/);
  });

  it("E: three retained segments block organizationReady via scope", () => {
    const segments = [0, 1, 2].map((index) => ({
      id: String(index),
      segmentIndex: index,
      titleHint: `Topic ${index}`,
      evidenceText: `Body ${index}`,
      evidenceStart: index,
      evidenceEnd: index + 1,
      status: "proposed" as const,
    }));
    assert.equal(countRetainedProposedSegments(segments), 3);
    const scope = deriveSmartIngestSourceScope({
      analysisStatus: "ready_for_review",
      latestAnalysisRunId: "run-1",
      segments,
    });
    assert.equal(scope.blocksSourceLevelOrganize, true);
    assert.equal(scope.blocksSourceLevelComparison, true);
  });

  it("F: multi-topic blocks source-level organize button in ingest UI", () => {
    assert.match(ingest, /blocksSourceLevelPipeline/);
    assert.match(ingest, /!blocksSourceLevelPipeline/);
    assert.match(ingest, /data-smart-ingest-multi-topic-block/);
  });

  it("G: organizer error restores status and clears organizing busy state", () => {
    assert.match(ingest, /previousStatus/);
    assert.match(ingest, /status: previousStatus/);
    assert.match(ingest, /finally \{\s*setBusy\(false\)/);
  });

  it("H: SMART_INGEST_SEGMENT_SCOPE_REQUIRED maps to localized ingest copy", () => {
    const message = getKnowledgeErrorMessage(
      (key) => {
        const map: Record<string, string> = {
          "knowledge.ingest.smartIngestSegmentScopeRequired":
            zhHans.knowledge.ingest.smartIngestSegmentScopeRequired,
        };
        return map[key] ?? key;
      },
      KNOWLEDGE_ERROR_CODES.SMART_INGEST_SEGMENT_SCOPE_REQUIRED,
    );
    assert.match(message, /独立主题/);
    assert.doesNotMatch(message, /knowledge\.ingest\./);
    assert.ok(en.knowledge.ingest.smartIngestSegmentScopeRequired);
    assert.ok(zhHant.knowledge.ingest.smartIngestSegmentScopeRequired);
  });

  it("I: single retained segment keeps organize available in scope", () => {
    const scope = deriveSmartIngestSourceScope({
      analysisStatus: "ready_for_review",
      latestAnalysisRunId: "run-1",
      segments: [
        {
          id: "only",
          segmentIndex: 0,
          titleHint: "Chase",
          evidenceText: "Chase Private Client",
          evidenceStart: 0,
          evidenceEnd: 20,
          status: "proposed",
        },
      ],
    });
    assert.equal(scope.blocksSourceLevelOrganize, false);
    assert.equal(scope.singleSegmentEvidenceText, "Chase Private Client");
  });

  it("analysis section uses stable key and refreshes source on completion", () => {
    assert.match(ingest, /key=\{selected\.id\}/);
    assert.match(ingest, /onAnalysisComplete=\{handleAnalysisComplete\}/);
    assert.match(analysis, /onAnalysisComplete\?\.\(\)/);
  });

  it("organizer scope error scrolls to analyze section", () => {
    assert.match(ingest, /SMART_INGEST_SEGMENT_SCOPE_REQUIRED/);
    assert.match(ingest, /analyzeSectionRef/);
  });
});
