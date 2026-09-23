import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHASE_PRIVATE_CLIENT_FIXTURE_TEXT } from "@/lib/knowledge/knowledge-evidence-grounding";
import {
  assessOrganizerOutputCompleteness,
  ORGANIZER_CRITICAL_FACT_HUMAN_REVIEW_WARNING,
} from "@/lib/knowledge/knowledge-evidence-grounding";
import {
  assessVisionExtractionUsability,
  hasSubstantiveSourceEvidence,
  isNonEvidenceExtractionText,
  LOCAL_PREVIEW_MOCK_NO_VISION_MESSAGE,
} from "@/lib/knowledge/knowledge-extraction-usability";
import { GENERIC_VISION_EXTRACTION_PLACEHOLDER } from "@/lib/knowledge/source-duplicate";
import { buildVisionExtractionMetadata } from "@/lib/knowledge/vision-extraction-metadata";
import {
  applyVisionIntegrityToMetadata,
  assessVisionExtractionIntegrity,
} from "@/lib/knowledge/knowledge-vision-integrity";

describe("knowledge extraction usability", () => {
  it("A: failure placeholder cannot be confirmed as evidence", () => {
    assert.equal(
      isNonEvidenceExtractionText(
        `${GENERIC_VISION_EXTRACTION_PLACEHOLDER}\n[fixture:abc123]`,
      ),
      true,
    );
    assert.equal(hasSubstantiveSourceEvidence(GENERIC_VISION_EXTRACTION_PLACEHOLDER), false);
  });

  it("B: failure placeholder blocks organizer grounding", () => {
    assert.equal(
      hasSubstantiveSourceEvidence(GENERIC_VISION_EXTRACTION_PLACEHOLDER),
      false,
    );
    assert.equal(hasSubstantiveSourceEvidence(LOCAL_PREVIEW_MOCK_NO_VISION_MESSAGE), false);
  });

  it("C: manually replaced substantive text is usable", () => {
    const manual = `Chase Private Client\n${CHASE_PRIVATE_CLIENT_FIXTURE_TEXT}`;
    assert.equal(isNonEvidenceExtractionText(manual), false);
    assert.equal(hasSubstantiveSourceEvidence(manual), true);
  });

  it("D: requiresHumanReview remains separate from unusable", () => {
    const metadata = buildVisionExtractionMetadata({
      quality: "medium",
      warnings: [],
    });
    const integrity = assessVisionExtractionIntegrity({
      rawText: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      extractionMetadata: metadata,
      extractionMethod: "vision",
      extractionModel: "@cf/google/gemma-4-26b-a4b-it",
    });
    const applied = applyVisionIntegrityToMetadata(metadata, integrity);
    assert.equal(integrity.requiresHumanReview, true);
    assert.equal(applied.integrityTrace?.extractionUsable, true);
    const unusable = assessVisionExtractionUsability(
      GENERIC_VISION_EXTRACTION_PLACEHOLDER,
    );
    assert.equal(unusable.usable, false);
    assert.equal(unusable.requiresHumanReview, true);
  });

  it("E: mock preview message is not business evidence", () => {
    assert.equal(isNonEvidenceExtractionText(LOCAL_PREVIEW_MOCK_NO_VISION_MESSAGE), true);
  });

  it("F: chase fixture retains important visible facts", () => {
    for (const anchor of [
      "15W",
      "60 天",
      "10 万美元",
      "25 万美元",
      "15,000",
      "40,000",
      "Chase Private Client",
      "大通私人银行账户",
    ]) {
      assert.match(CHASE_PRIVATE_CLIENT_FIXTURE_TEXT, new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("A: all critical facts retained → completeness passes", () => {
    const completeness = assessOrganizerOutputCompleteness(
      CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      {
        title: "Chase Private Client（大通私人银行账户）",
        summary: "开户资料与资金流动限制",
        body: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
        suggestedCategory: null,
        warnings: [],
      },
    );
    assert.equal(completeness.ok, true);
    assert.equal(completeness.requiresHumanReview, false);
    assert.equal(completeness.missingCriticalAnchors.length, 0);
  });

  it("B: one amount missing → human review required", () => {
    const body = CHASE_PRIVATE_CLIENT_FIXTURE_TEXT.replace(/25 万美元/g, "");
    const completeness = assessOrganizerOutputCompleteness(
      CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      {
        title: "Chase Private Client",
        summary: "summary",
        body,
        suggestedCategory: null,
        warnings: [],
      },
    );
    assert.equal(completeness.ok, true);
    assert.equal(completeness.requiresHumanReview, true);
    assert.equal(
      completeness.humanReviewWarning,
      ORGANIZER_CRITICAL_FACT_HUMAN_REVIEW_WARNING,
    );
    assert.ok(completeness.missingCriticalAnchors.some((a) => a.includes("25")));
  });

  it("C: one deadline missing → human review required", () => {
    const body = CHASE_PRIVATE_CLIENT_FIXTURE_TEXT.replace(/60 天内/g, "近期");
    const completeness = assessOrganizerOutputCompleteness(
      CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      {
        title: "Chase Private Client",
        summary: "summary",
        body,
        suggestedCategory: null,
        warnings: [],
      },
    );
    assert.equal(completeness.requiresHumanReview, true);
    assert.ok(
      completeness.missingCriticalAnchors.some((anchor) => anchor.includes("60")),
    );
  });

  it("D: one required document missing → human review required", () => {
    const completeness = assessOrganizerOutputCompleteness(
      CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      {
        title: "Chase Private Client",
        summary: "summary",
        body: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT.replace(/护照[^\n]*\n?/u, ""),
        suggestedCategory: null,
        warnings: [],
      },
    );
    assert.equal(completeness.requiresHumanReview, true);
    assert.ok(completeness.missingCriticalAnchors.includes("护照"));
  });

  it("E: descriptive wording paraphrased → allowed", () => {
    const source = `${CHASE_PRIVATE_CLIENT_FIXTURE_TEXT}\n本页仅提供开户流程的背景说明，便于客户理解整体安排，不构成额外业务承诺。`;
    const completeness = assessOrganizerOutputCompleteness(source, {
      title: "Chase Private Client",
      summary: "开户资料与限额说明",
      body: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      suggestedCategory: null,
      warnings: [],
    });
    assert.equal(completeness.requiresHumanReview, false);
    assert.equal(completeness.missingCriticalAnchors.length, 0);
  });

  it("Chase regression: full-anchor organizer body passes", () => {
    const required = [
      "Chase Private Client",
      "60 天",
      "15W",
      "ACH",
      "10 万美元",
      "25 万美元",
      "Zelle",
      "15,000",
      "40,000",
    ];
    const completeness = assessOrganizerOutputCompleteness(
      CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      {
        title: "Chase Private Client",
        summary: "summary",
        body: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
        suggestedCategory: null,
        warnings: [],
      },
    );
    assert.equal(completeness.requiresHumanReview, false);
    for (const anchor of required) {
      assert.ok(
        !completeness.missingCriticalAnchors.includes(anchor),
        `expected anchor retained: ${anchor}`,
      );
    }
  });
});
