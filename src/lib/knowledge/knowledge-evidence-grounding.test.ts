import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessVisionExtractionReliability,
  isKnownHallucinationBankingTemplate,
  KNOWN_HALLUCINATION_BANKING_TEMPLATE,
  TURKEY_HK_INCORPORATION_FIXTURE_TEXT,
  validateOrganizerEvidenceGrounding,
} from "@/lib/knowledge/knowledge-evidence-grounding";

describe("knowledge evidence grounding", () => {
  it("detects the known HSBC hallucination template", () => {
    assert.equal(
      isKnownHallucinationBankingTemplate(KNOWN_HALLUCINATION_BANKING_TEMPLATE),
      true,
    );
  });

  it("blocks organizer output with unsupported HSBC facts for Turkey/HK source", () => {
    const result = validateOrganizerEvidenceGrounding(
      TURKEY_HK_INCORPORATION_FIXTURE_TEXT,
      {
        title: "汇丰香港",
        summary: "最低资产要求 50 万",
        body: "汇丰香港\n最低资产要求 50 万\n办理周期 4–6 周",
        suggestedCategory: null,
        warnings: [],
      },
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.reason === "unsupported_claims" || result.reason === "known_template",
    );
  });

  it("allows organizer output grounded in Turkey/HK incorporation source", () => {
    const result = validateOrganizerEvidenceGrounding(
      TURKEY_HK_INCORPORATION_FIXTURE_TEXT,
      {
        title: "ECHFRONT (Hong Kong) Limited 公司註冊",
        summary: "土耳其投資入籍計劃與香港公司註冊證明書",
        body: TURKEY_HK_INCORPORATION_FIXTURE_TEXT,
        suggestedCategory: null,
        warnings: ["資訊不足 / 需要人工補充"],
      },
    );
    assert.equal(result.ok, true);
  });

  it("requires human review for low-quality vision extraction", () => {
    const result = assessVisionExtractionReliability({
      rawText: "部分可讀文字",
      extractionMetadata: {
        schemaVersion: "knowledge-vision-extraction-v1",
        quality: "low",
        partial: true,
        pagesSucceeded: 1,
        pagesTotal: 1,
        warnings: [{ code: "BLURRY_IMAGE", message: "模糊" }],
        pages: [],
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.requiresHumanReview, true);
    assert.equal(result.reason, "insufficient_extraction");
  });
});
