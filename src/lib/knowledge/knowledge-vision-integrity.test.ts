import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
  KNOWN_HALLUCINATION_BANKING_TEMPLATE,
  TURKEY_HK_INCORPORATION_FIXTURE_TEXT,
  validateOrganizerEvidenceGrounding,
} from "@/lib/knowledge/knowledge-evidence-grounding";
import {
  assessVisionExtractionIntegrity,
  detectHighRiskVisionFacts,
  sourceBlocksOrganizeForVisionReview,
  sourceRequiresVisionHumanReview,
  VISION_INTEGRITY_WARNING_CODES,
} from "@/lib/knowledge/knowledge-vision-integrity";
import { assessVisionExtractionReliability } from "@/lib/knowledge/knowledge-evidence-grounding";
import { buildVisionExtractionMetadata } from "@/lib/knowledge/vision-extraction-metadata";
import { extractKnowledgeSourceText } from "@/lib/knowledge/source-extraction";
import { buildTestDocxBytes } from "@/lib/knowledge/test-fixtures/source-documents";

describe("knowledge vision integrity", () => {
  it("CASE A blocks hallucinated organizer output against grounded extraction", () => {
    const result = validateOrganizerEvidenceGrounding(
      TURKEY_HK_INCORPORATION_FIXTURE_TEXT,
      {
        title: "汇丰香港",
        summary: "最低资产要求 50 万",
        body: KNOWN_HALLUCINATION_BANKING_TEMPLATE,
        suggestedCategory: null,
        warnings: [],
      },
    );
    assert.equal(result.ok, false);
  });

  it("CASE B blocks auto-organize when extraction hallucinates HSBC template", () => {
    const metadata = buildVisionExtractionMetadata({
      quality: "high",
      warnings: [],
    });
    const integrity = assessVisionExtractionIntegrity({
      rawText: KNOWN_HALLUCINATION_BANKING_TEMPLATE,
      extractionMetadata: metadata,
      extractionMethod: "vision",
      extractionModel: "@cf/google/gemma-4-26b-a4b-it",
    });
    assert.equal(integrity.requiresHumanReview, true);
    assert.equal(integrity.reason, "known_template");
    assert.equal(
      sourceRequiresVisionHumanReview({
        extractionMethod: "vision",
        extractionMetadata: metadata,
        rawText: KNOWN_HALLUCINATION_BANKING_TEMPLATE,
      }),
      true,
    );
    const organizerEligibility = assessVisionExtractionReliability({
      rawText: KNOWN_HALLUCINATION_BANKING_TEMPLATE,
      extractionMetadata: metadata,
      extractionMethod: "vision",
      extractionModel: "@cf/google/gemma-4-26b-a4b-it",
    });
    assert.equal(organizerEligibility.requiresHumanReview, true);
  });

  it("does not let vision model self-certify high quality without review", () => {
    const metadata = buildVisionExtractionMetadata({
      quality: "high",
      warnings: [],
    });
    const integrity = assessVisionExtractionIntegrity({
      rawText: TURKEY_HK_INCORPORATION_FIXTURE_TEXT,
      extractionMetadata: metadata,
      extractionMethod: "vision",
      extractionModel: "@cf/google/gemma-4-26b-a4b-it",
    });
    assert.equal(integrity.integrityTrace?.modelReportedQuality, "high");
    assert.equal(integrity.integrityTrace?.effectiveQuality, "medium");
    assert.equal(integrity.requiresHumanReview, true);
    assert.ok(
      integrity.integrityTrace?.reasons.includes(
        VISION_INTEGRITY_WARNING_CODES.MODEL_QUALITY_DOWNGRADED,
      ),
    );
  });

  it("detects high-risk facts in Turkey/HK incorporation text", () => {
    const facts = detectHighRiskVisionFacts(TURKEY_HK_INCORPORATION_FIXTURE_TEXT);
    assert.ok(facts.includes("土耳其"));
    assert.ok(facts.includes("money_amount"));
    assert.ok(facts.includes("processing_time"));
    assert.ok(!facts.includes("汇丰香港"));
  });

  it("blocks organize until vision review is confirmed", () => {
    const metadata = buildVisionExtractionMetadata({
      quality: "medium",
      warnings: [],
    });
    assert.equal(
      sourceBlocksOrganizeForVisionReview({
        extractionMethod: "vision",
        extractionMetadata: metadata,
        rawText: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      }),
      true,
    );
    const confirmed = {
      ...metadata,
      humanReviewConfirmedAt: "2026-09-22T00:00:00.000Z",
      humanReviewConfirmedByUserId: "user-1",
    };
    assert.equal(
      sourceBlocksOrganizeForVisionReview({
        extractionMethod: "vision",
        extractionMetadata: confirmed,
        rawText: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      }),
      false,
    );
  });

  it("requires human review for all generative vision extractions", async () => {
    process.env.CRM_ALLOW_MOCK_AI = "1";
    const result = await extractKnowledgeSourceText({
      bytes: (await import("@/lib/knowledge/test-fixtures/source-images")).buildTestPngBytes(),
      filename: "p2c-b1-clear-chinese.png",
      mimeType: "image/png",
    });
    assert.equal(result.extractionMethod, "vision");
    assert.equal(result.extractionMetadata?.integrityTrace?.requiresHumanReview, true);
    assert.equal(
      sourceRequiresVisionHumanReview({
        extractionMethod: "vision",
        extractionMetadata: result.extractionMetadata ?? null,
        rawText: result.text,
      }),
      true,
    );
  });

  it("does not require vision human review for DOCX deterministic extraction", async () => {
    const bytes = await buildTestDocxBytes({
      paragraphs: ["Policy paragraph"],
      table: [["Product", "Limit"], ["Alpha", "100"]],
    });
    const result = await extractKnowledgeSourceText({
      bytes,
      filename: "policy.docx",
    });
    assert.notEqual(result.extractionMethod, "vision");
    assert.equal(
      sourceRequiresVisionHumanReview({
        extractionMethod: result.extractionMethod ?? null,
        extractionMetadata: result.extractionMetadata ?? null,
        rawText: result.text,
      }),
      false,
    );
  });
});
