import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildKnowledgeOrganizerSystemPrompt } from "@/lib/knowledge/ai-organizer-prompt";
import { buildMockKnowledgeOrganizationOutput } from "@/lib/knowledge/knowledge-mock-organizer";
import { canonicalizeKnowledgeArticleText } from "@/lib/knowledge/knowledge-chinese-script";
import {
  finalizeKnowledgeOrganizerArticleOutput,
  isGenericOrganizerWarning,
  sanitizeOrganizerWarnings,
  validateKnowledgeArticleSummary,
} from "@/lib/knowledge/knowledge-organizer-article-quality";
import { CHASE_PRIVATE_CLIENT_FIXTURE_TEXT } from "@/lib/knowledge/knowledge-evidence-grounding";
import zhHant from "@/i18n/locales/zh-Hant";

const TRADITIONAL_CHASE = `Chase Private Client

一、資料要求
1. 身份證正反面
2. 有效護照
3. 60天內美國地址銀行對賬單

二、資金流動限制
1. ACH日額度10萬美元
2. Zelle每日上限15,000美元`;

describe("knowledge article quality hotfix", () => {
  it("A–C: mock organizer summary is one semantic sentence without list structure", () => {
    const output = buildMockKnowledgeOrganizationOutput({
      sourceTitle: "[PROD-SMOKE] Chase",
      rawText: TRADITIONAL_CHASE,
    });
    assert.ok(output.summary);
    assert.doesNotMatch(output.summary!, /\n/u);
    assert.doesNotMatch(output.summary!, /^\d+[.、]/u);
    const validation = validateKnowledgeArticleSummary({
      summary: output.summary,
      title: output.title,
      body: output.body,
    });
    assert.equal(validation.valid, true);
    assert.ok(!output.body.startsWith(output.summary ?? ""));
  });

  it("B/D: title-only and body-prefix summaries are rejected", () => {
    const body = CHASE_PRIVATE_CLIENT_FIXTURE_TEXT;
    assert.equal(
      validateKnowledgeArticleSummary({
        summary: "Chase Private Client",
        title: "Chase Private Client",
        body,
      }).valid,
      false,
    );
    assert.equal(
      validateKnowledgeArticleSummary({
        summary: body.slice(0, 40),
        title: "Chase Private Client 开户资料与资金流动要求",
        body,
      }).valid,
      false,
    );
  });

  it("E/G: traditional organizer fields normalize to simplified while preserving English", () => {
    const output = finalizeKnowledgeOrganizerArticleOutput({
      title: "Chase Private Client 開戶資料",
      summary: "Chase Private Client 開戶需提供身份證與護照。",
      body: TRADITIONAL_CHASE,
      suggestedCategory: null,
      warnings: [],
    });
    assert.match(output.body, /资料要求/u);
    assert.doesNotMatch(output.body, /資料要求/u);
    assert.match(output.summary!, /身份证/u);
    assert.match(output.body, /Chase Private Client/);
    assert.match(output.body, /ACH/);
    assert.match(output.body, /15,000/);
  });

  it("F: raw source text is not mutated by organizer output builders", () => {
    const raw = TRADITIONAL_CHASE;
    buildMockKnowledgeOrganizationOutput({ sourceTitle: null, rawText: raw });
    assert.match(raw, /資料要求/u);
    assert.match(raw, /身份證/u);
  });

  it("H/I: generic warnings removed; specific critical warnings kept", () => {
    assert.equal(isGenericOrganizerWarning("資訊不足 / 需要人工補充"), true);
    const sanitized = sanitizeOrganizerWarnings([
      "資訊不足 / 需要人工補充",
      "缺少重要事实：15W",
    ]);
    assert.deepEqual(sanitized, ["缺少重要事实：15W"]);
  });

  it("J/K: taxonomy i18n labels preserved", () => {
    assert.equal(zhHant.knowledge.ingest.businessCategory, "關聯業務（AI識別）");
    assert.equal(zhHant.knowledge.ingest.knowledgeLibraryCategory, "知識庫分類");
    assert.ok(zhHant.knowledge.ingest.knowledgeCategoryRequiredBeforeDraft);
  });

  it("M: mock organizer uses simplified canonical body for Chase", () => {
    const output = buildMockKnowledgeOrganizationOutput({
      sourceTitle: null,
      rawText: TRADITIONAL_CHASE,
    });
    assert.match(output.title, /开户/u);
    assert.equal(
      canonicalizeKnowledgeArticleText(output.body),
      output.body,
    );
    assert.equal(
      sanitizeOrganizerWarnings(output.warnings).some(isGenericOrganizerWarning),
      false,
    );
  });

  it("organizer prompt requires semantic summary contract", () => {
    const prompt = buildKnowledgeOrganizerSystemPrompt("zh-Hans");
    assert.match(prompt, /one sentence/i);
    assert.match(prompt, /Never use generic warnings/i);
  });
});
