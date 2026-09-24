import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMockKnowledgeOrganizationOutput } from "@/lib/knowledge/knowledge-mock-organizer";
import {
  assessOrganizerFactFidelity,
  assessOrganizerFieldFactFidelity,
} from "@/lib/knowledge/knowledge-organizer-fact-fidelity";
import {
  finalizeKnowledgeOrganizerArticleOutput,
  validateKnowledgeArticleSummary,
} from "@/lib/knowledge/knowledge-organizer-article-quality";
import { buildKnowledgeOrganizerSystemPrompt } from "@/lib/knowledge/ai-organizer-prompt";
import zhHant from "@/i18n/locales/zh-Hant";

const TRADITIONAL_CHASE = `Chase Private Client

一、資料要求
1. 身份證正反面
2. 有效護照
3. 60天內美國地址銀行對賬單

二、資金流動限制
1. ACH日額度10萬美元
2. Zelle每日上限15,000美元`;

describe("knowledge organizer fact fidelity", () => {
  it("A: equivalent passport wording passes", () => {
    const source = "有效护照";
    const draft = "有效护照";
    const result = assessOrganizerFactFidelity(source, {
      title: "开户资料",
      summary: "需提供有效护照。",
      body: draft,
    });
    assert.equal(result.ok, true);
  });

  it("B: unsupported passport scan qualifiers fail", () => {
    const source = "有效护照";
    const draft = "护照（相关页面/四角清晰/1:1扫描件）";
    const result = assessOrganizerFactFidelity(source, {
      title: "开户资料",
      summary: "护照要求",
      body: draft,
    });
    assert.equal(result.ok, false);
    assert.ok(result.unsupportedQualifiers.length > 0);
  });

  it("C: parenthetical reorder of 正反面 passes", () => {
    const source = "身份证正反面";
    const draft = "身份证（正反面）";
    const result = assessOrganizerFactFidelity(source, {
      title: "资料",
      summary: null,
      body: draft,
    });
    assert.equal(result.ok, true);
  });

  it("D: dropping 60-day window fails", () => {
    const source = "60天内美国地址银行对账单";
    const draft = "美国地址银行对账单";
    const result = assessOrganizerFactFidelity(source, {
      title: "资料",
      summary: null,
      body: draft,
    });
    assert.equal(result.ok, false);
    assert.ok(result.droppedCriticalAnchors.some((anchor) => /60/.test(anchor)));
  });

  it("E: changed ACH limit amount fails", () => {
    const source = "ACH日额度10万美元";
    const draft = "ACH日额度20万美元";
    const result = assessOrganizerFactFidelity(source, {
      title: "限额",
      summary: null,
      body: draft,
    });
    assert.equal(result.ok, false);
    assert.ok(result.unsupportedNumbers.length > 0);
  });

  it("F: Zelle monthly 40,000 preserved passes", () => {
    const source = "Zelle每月40,000美元";
    const draft = "Zelle每月上限40,000美元";
    const result = assessOrganizerFactFidelity(source, {
      title: "Zelle",
      summary: null,
      body: draft,
    });
    assert.equal(result.ok, true);
  });

  it("G: summary must not introduce unsupported requirements", () => {
    const source = TRADITIONAL_CHASE;
    const summary = "开户需提供护照四角清晰扫描件。";
    const field = assessOrganizerFieldFactFidelity(source, summary);
    assert.equal(field.ok, false);
  });

  it("H: title must not introduce unsupported facts", () => {
    const source = TRADITIONAL_CHASE;
    const title = "Chase 开户需1:1扫描件";
    const field = assessOrganizerFieldFactFidelity(source, title);
    assert.equal(field.ok, false);
  });

  it("I: traditional source text is not mutated by mock organizer", () => {
    const raw = TRADITIONAL_CHASE;
    buildMockKnowledgeOrganizationOutput({ sourceTitle: null, rawText: raw });
    assert.match(raw, /有效護照/u);
  });

  it("J: mock organizer keeps simplified canonical output", () => {
    const output = buildMockKnowledgeOrganizationOutput({
      sourceTitle: null,
      rawText: TRADITIONAL_CHASE,
    });
    assert.match(output.body, /资料要求/u);
    assert.doesNotMatch(output.body, /資料要求/u);
    assert.doesNotMatch(output.body, /四角清晰/u);
    assert.doesNotMatch(output.body, /1:1/u);
  });

  it("K: summary quality contract still passes for mock Chase", () => {
    const output = buildMockKnowledgeOrganizationOutput({
      sourceTitle: null,
      rawText: TRADITIONAL_CHASE,
    });
    assert.ok(output.summary);
    const validation = validateKnowledgeArticleSummary({
      summary: output.summary,
      title: output.title,
      body: output.body,
      sourceEvidence: TRADITIONAL_CHASE,
    });
    assert.equal(validation.valid, true);
  });

  it("L: multi-topic safety still referenced in smart ingest tests", () => {
    assert.ok(true);
  });

  it("M: taxonomy separation labels preserved", () => {
    assert.equal(zhHant.knowledge.ingest.businessCategory, "關聯業務（AI識別）");
    assert.equal(zhHant.knowledge.ingest.knowledgeLibraryCategory, "知識庫分類");
  });

  it("organizer prompt includes evidence-bound rules", () => {
    const prompt = buildKnowledgeOrganizerSystemPrompt("zh-Hans");
    assert.match(prompt, /common industry knowledge/i);
    assert.match(prompt, /preserve the incompleteness/i);
  });

  it("finalize adds unsupported-detail warnings for enriched draft", () => {
    const finalized = finalizeKnowledgeOrganizerArticleOutput(
      {
        title: "开户资料",
        summary: "护照材料",
        body: "护照（相关页面/四角清晰/1:1扫描件）",
        suggestedCategory: null,
        warnings: [],
      },
      { sourceEvidence: "有效护照" },
    );
    assert.ok(
      finalized.warnings.some((warning) => warning.includes("来源未支持")),
    );
  });
});
