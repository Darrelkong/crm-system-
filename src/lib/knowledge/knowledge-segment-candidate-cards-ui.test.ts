import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import { evidencePreviewForCandidate } from "@/components/knowledge/knowledge-segment-candidate-cards";

const root = process.cwd();
const analysis = readFileSync(
  join(root, "src/components/knowledge/knowledge-smart-ingest-analysis-section.tsx"),
  "utf8",
);
const cards = readFileSync(
  join(root, "src/components/knowledge/knowledge-segment-candidate-cards.tsx"),
  "utf8",
);
const candidateCard = readFileSync(
  join(root, "src/components/knowledge/knowledge-segment-candidate-card.tsx"),
  "utf8",
);
const ingest = readFileSync(
  join(root, "src/components/knowledge/knowledge-ingest-client.tsx"),
  "utf8",
);

describe("knowledge segment candidate cards UI (2E-2)", () => {
  it("loads candidates via GET API only", () => {
    assert.match(analysis, /\/api\/knowledge\/sources\/\$\{source\.id\}\/candidates/);
    assert.doesNotMatch(cards, /knowledgeSourceSegmentCandidates/);
  });

  it("refreshes candidates after segment confirmation and sorts by segmentIndex", () => {
    assert.match(analysis, /refreshCandidates/);
    assert.match(analysis, /a\.segmentIndex - b\.segmentIndex/);
    assert.match(cards, /data-candidate-cards-section/);
  });

  it("uses materialize POST only as one-time fallback", () => {
    assert.match(analysis, /materializeAttemptedRef/);
    assert.match(analysis, /method: "POST"/);
  });

  it("hides superseded candidates via active GET default", () => {
    assert.doesNotMatch(analysis, /includeSuperseded/);
  });

  it("does not show source-level business identity on list wrapper", () => {
    assert.doesNotMatch(cards, /businessIdentity/);
  });

  it("shows localized pending label hooks", () => {
    assert.match(candidateCard, /smartIngestCandidateOrganized/);
    assert.equal(zhHans.knowledge.ingest.smartIngestCandidatePending, "待处理");
    assert.equal(zhHant.knowledge.ingest.smartIngestCandidatePending, "待處理");
    assert.equal(en.knowledge.ingest.smartIngestCandidatePending, "Pending");
  });

  it("evidence preview uses segment evidence text", () => {
    const preview = evidencePreviewForCandidate("line1\nline2\nline3\nline4");
    assert.match(preview, /line1/);
    assert.doesNotMatch(preview, /line4/);
    assert.match(candidateCard, /segmentEvidenceText/);
    assert.match(candidateCard, /data-candidate-evidence-preview/);
  });

  it("candidate load error offers retry without duplicating client-side", () => {
    assert.match(cards, /data-candidate-cards-retry/);
    assert.doesNotMatch(analysis, /insert.*candidates/i);
  });

  it("multi-topic organize block stays disabled with continuation copy", () => {
    assert.match(ingest, /data-smart-ingest-multi-topic-block/);
    assert.match(ingest, /smartIngestStepIndependentOrganize/);
    assert.match(ingest, /data-organize-button/);
    assert.match(ingest, /blocksSourceLevelPipeline/);
  });

  it("candidate cards expose functional organize button", () => {
    assert.match(candidateCard, /data-candidate-organize-button/);
    assert.match(candidateCard, /\/candidates\/\$\{candidate\.id\}\/organize/);
    assert.match(candidateCard, /smartIngestCandidateOrganizeIndependently/);
    assert.doesNotMatch(candidateCard, /smartIngestCandidateNextStep/);
  });

  it("mobile-friendly stacked card markup", () => {
    assert.match(cards, /space-y-3/);
    assert.match(candidateCard, /data-candidate-card/);
    assert.doesNotMatch(cards, /<table/);
  });
});

describe("knowledge segment candidate partial review + refresh stability (2E-4B)", () => {
  it("shows candidates when any segment is confirmed, not only after full review", () => {
    assert.match(analysis, /showCandidateSection/);
    assert.doesNotMatch(
      analysis,
      /segmentReviewComplete\s*\?\s*\(\s*<KnowledgeSegmentCandidateCards/,
    );
  });

  it("loads candidates on mount when confirmedCount > 0 without waiting for proposed zero", () => {
    assert.match(analysis, /confirmedSegmentCount === 0/);
    assert.match(analysis, /stableAnalysisRunId/);
    assert.doesNotMatch(analysis, /proposedRemaining === 0 && confirmedCount > 0/);
  });

  it("hides confirmed segments that already have candidate cards from review list", () => {
    assert.match(analysis, /segmentsForReviewList/);
    assert.match(analysis, /candidateSegmentIds/);
  });

  it("preserves candidate cards during background refresh", () => {
    assert.match(cards, /loading && candidates\.length === 0/);
    assert.match(cards, /data-candidate-cards-background-refresh/);
  });

  it("organizer draft hydration does not notify parent list", () => {
    const loadDraftBlock = candidateCard.slice(
      candidateCard.indexOf("const loadDraft"),
      candidateCard.indexOf("useEffect(() => {", candidateCard.indexOf("const loadDraft")),
    );
    assert.doesNotMatch(loadDraftBlock, /onUpdated\(\)/);
  });

  it("uses stable materialize attempt ref keyed by source and analysis run", () => {
    assert.match(analysis, /materializeAttemptedRef/);
    assert.match(analysis, /stableAnalysisRunId/);
    assert.doesNotMatch(analysis, /\[source\.id, run\?\.id\]/);
  });

  it("preserves candidate lineage across transient null run state", () => {
    assert.match(analysis, /resolveStableAnalysisRunId/);
    assert.match(analysis, /shouldResetCandidateLineage/);
    assert.match(analysis, /candidatesEverLoadedRef/);
  });

  it("does not bind candidate refresh effect to mutable run object identity", () => {
    assert.match(analysis, /\[confirmedSegmentCount, refreshCandidates, stableAnalysisRunId\]/);
    assert.doesNotMatch(analysis, /\[refreshCandidates, run\]/);
  });

  it("incremental preparing copy is localized", () => {
    assert.equal(
      zhHans.knowledge.ingest.smartIngestCandidatesIncrementalPreparing,
      "正在新增已保留主题…",
    );
    assert.equal(
      en.knowledge.ingest.smartIngestCandidatesIncrementalPreparing,
      "Adding newly kept topics…",
    );
  });
});
