import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHASE_PRIVATE_CLIENT_FIXTURE_TEXT } from "@/lib/knowledge/knowledge-evidence-grounding";
import {
  assessOrganizerOutputCompleteness,
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

  it("G: organizer retains high-value numeric facts", () => {
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
    assert.equal(completeness.missingAnchors.length, 0);
  });

  it("H: organizer drops material facts triggers review", () => {
    const completeness = assessOrganizerOutputCompleteness(
      CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      {
        title: "Chase",
        summary: "keywords only",
        body: "Chase Private Client\n身份证\n护照",
        suggestedCategory: null,
        warnings: [],
      },
    );
    assert.equal(completeness.ok, false);
    assert.ok(completeness.missingAnchors.length > 0);
  });
});
