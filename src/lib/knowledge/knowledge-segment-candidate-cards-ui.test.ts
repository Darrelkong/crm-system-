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
