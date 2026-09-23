import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildKnowledgeOrganizerSystemPrompt } from "@/lib/knowledge/ai-organizer-prompt";
import {
  KNOWLEDGE_ARTICLE_CONTENT_LOCALE,
  knowledgeOrganizerContentLanguage,
} from "@/lib/knowledge/constants";
import { assessOrganizerOutputCompleteness } from "@/lib/knowledge/knowledge-evidence-grounding";
import {
  criticalFactAnchorsMissingFromOutput,
  organizerOutputContainsFact,
} from "@/lib/knowledge/knowledge-extraction-usability";
import {
  normalizeForKnowledgeFactComparison,
  toSimplifiedChineseForComparison,
} from "@/lib/knowledge/knowledge-chinese-script";
import {
  resolveOrganizerKnowledgeCategoryId,
  resolveOrganizerRequestedProjectCode,
} from "@/lib/knowledge/knowledge-ingest-organizer-draft";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import en from "@/i18n/locales/en";

const TRADITIONAL_CHASE_SOURCE = `Chase Private Client

一、資料要求
1. 身份證正反面
2. 有效護照
3. 60天內美國地址銀行對賬單

二、資金流動限制
1. ACH日額度10萬美元
2. Zelle每日上限15,000美元`;

describe("knowledge language + taxonomy hotfix", () => {
  it("A: 身份證/護照 traditional draft in simplified passes fact check", () => {
    const traditionalDocs = `一、資料要求
1. 身份證正反面
2. 有效護照`;
    const draft = `一、资料要求
1. 身份证正反面
2. 有效护照`;
    assert.equal(
      criticalFactAnchorsMissingFromOutput(traditionalDocs, draft).length,
      0,
    );
    const completeness = assessOrganizerOutputCompleteness(traditionalDocs, {
      title: "Chase Private Client",
      summary: "资料要求",
      body: draft,
      suggestedCategory: null,
      warnings: [],
    });
    assert.equal(completeness.requiresHumanReview, false);
    assert.equal(completeness.missingCriticalAnchors.length, 0);
  });

  it("B: omitting ID entirely still flags missing 身份证", () => {
    const draft = TRADITIONAL_CHASE_SOURCE.replace(/身份證[^\n]*\n?/u, "");
    const missing = criticalFactAnchorsMissingFromOutput(
      TRADITIONAL_CHASE_SOURCE,
      draft,
    );
    assert.ok(missing.includes("身份证"));
  });

  it("C: omitting 60天 still flagged", () => {
    const draft = "Chase Private Client\n资料要求\n护照\nZelle每日15,000美元\nACH日额度10万美元";
    const missing = criticalFactAnchorsMissingFromOutput(TRADITIONAL_CHASE_SOURCE, draft);
    assert.ok(missing.some((anchor) => anchor.includes("60")));
  });

  it("D: omitting 15,000 still flagged", () => {
    const draft = TRADITIONAL_CHASE_SOURCE.replace(/15,000/g, "");
    const missing = criticalFactAnchorsMissingFromOutput(
      TRADITIONAL_CHASE_SOURCE,
      draft,
    );
    assert.ok(missing.some((anchor) => anchor.includes("15,000")));
  });

  it("E/F: organizer content locale is zh-Hans with English names preserved in prompt", () => {
    assert.equal(knowledgeOrganizerContentLanguage(), KNOWLEDGE_ARTICLE_CONTENT_LOCALE);
    const prompt = buildKnowledgeOrganizerSystemPrompt(KNOWLEDGE_ARTICLE_CONTENT_LOCALE);
    assert.match(prompt, /简体中文/);
    assert.match(prompt, /Chase Private Client/);
    assert.match(prompt, /Simplified Chinese/);
  });

  it("G: comparison normalization does not mutate traditional source text", () => {
    const original = "身份證正反面";
    assert.notEqual(original, toSimplifiedChineseForComparison(original));
    assert.equal(normalizeForKnowledgeFactComparison("身份證"), "身份证");
    assert.equal(normalizeForKnowledgeFactComparison("護照"), "护照");
  });

  it("H: zh-Hant locale exposes business and knowledge category labels", () => {
    assert.equal(zhHant.knowledge.ingest.businessCategory, "關聯業務（AI識別）");
    assert.equal(zhHant.knowledge.ingest.knowledgeLibraryCategory, "知識庫分類");
    assert.equal(zhHans.knowledge.ingest.businessCategory, "关联业务（AI识别）");
    assert.equal(zhHans.knowledge.ingest.knowledgeLibraryCategory, "知识库分类");
    assert.equal(en.knowledge.ingest.businessCategory, "Related Business (AI detected)");
    assert.equal(en.knowledge.ingest.knowledgeLibraryCategory, "Knowledge Category");
  });

  it("I/J: ingest client references localized keys", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    assert.match(source, /knowledge\.ingest\.businessCategory/);
    assert.match(source, /knowledge\.ingest\.knowledgeLibraryCategory/);
    assert.match(source, /knowledgeCategoryRequiredBeforeDraft/);
  });

  it("K/L: organizer draft helpers keep business and category independent", () => {
    const identity = {
      title: "Chase",
      countryGroupCode: "united_states" as const,
      countryLabelZhHans: "美国",
      requestedProjectCode: "us_bank_account",
      categoryMatch: "confident" as const,
      signal: "chase_us_banking" as const,
      confidence: 5,
      identityConsistent: true,
    };
    assert.equal(
      resolveOrganizerRequestedProjectCode({
        identity,
        manualCode: "hk_bank_account",
        manualOverride: false,
      }),
      "us_bank_account",
    );
    assert.equal(
      resolveOrganizerRequestedProjectCode({
        identity,
        manualCode: "hk_bank_account",
        manualOverride: true,
      }),
      "hk_bank_account",
    );
    assert.equal(
      resolveOrganizerKnowledgeCategoryId({
        manualCategoryId: "cat-9",
        manualCategoryOverride: true,
      }),
      "cat-9",
    );
    assert.equal(
      resolveOrganizerKnowledgeCategoryId({
        manualCategoryId: "cat-9",
        manualCategoryOverride: false,
      }),
      "",
    );
  });

  it("organizerOutputContainsFact accepts script variants", () => {
    assert.equal(
      organizerOutputContainsFact("有效護照及身份證", "护照"),
      true,
    );
    assert.equal(
      organizerOutputContainsFact("银行对账单", "銀行對賬單"),
      true,
    );
  });
});
