import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHASE_PRIVATE_CLIENT_FIXTURE_TEXT } from "@/lib/knowledge/knowledge-evidence-grounding";
import { buildMockKnowledgeOrganizationOutput } from "@/lib/knowledge/knowledge-mock-organizer";
import {
  assessOrganizerFieldFactFidelity,
} from "@/lib/knowledge/knowledge-organizer-fact-fidelity";
import {
  buildDeterministicKnowledgeSummary,
  buildStructuredKnowledgeSummaryFromBody,
  isGenericKnowledgeSummaryMeta,
  validateKnowledgeArticleSummary,
} from "@/lib/knowledge/knowledge-organizer-article-quality";

const TRADITIONAL_CHASE = `Chase Private Client

一、資料要求
1. 身份證正反面
2. 有效護照
3. 60天內美國地址銀行對賬單
4. KYC個人資料
5. 激活款15W美金，下戶後一個月內達到

二、資金流動限制
1. ACH日額度10萬美元
2. 在線電匯日額度25萬美元
3. Zelle每日上限15,000美元`;

describe("knowledge summary specificity", () => {
  it("A: Chase body yields specific evidence-backed summary content", () => {
    const output = buildMockKnowledgeOrganizationOutput({
      sourceTitle: null,
      rawText: TRADITIONAL_CHASE,
    });
    assert.ok(output.summary);
    assert.match(output.summary!, /身份证|护照/u);
    assert.match(output.summary!, /60天/u);
    assert.match(output.summary!, /ACH/u);
    assert.match(output.summary!, /Zelle|15,000/u);
  });

  it("B: summary is not section-header template only", () => {
    const generic =
      "Chase Private Client开户与运营要求涵盖资料要求、资金流动限制等要点，具体材料、激活资金与交易额度以正文为准。";
    assert.equal(isGenericKnowledgeSummaryMeta(generic), true);
    const output = buildMockKnowledgeOrganizationOutput({
      sourceTitle: null,
      rawText: TRADITIONAL_CHASE,
    });
    assert.doesNotMatch(output.summary!, /涵盖资料要求、资金流动限制等要点/u);
  });

  it("C: rejects generic filler 具体内容以正文为准", () => {
    assert.equal(
      validateKnowledgeArticleSummary({
        summary: "Chase Private Client开户相关内容，具体内容以正文为准。",
        title: "Chase Private Client 开户资料与资金流动要求",
        body: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      }).valid,
      false,
    );
  });

  it("D: summary remains one sentence", () => {
    const output = buildMockKnowledgeOrganizationOutput({
      sourceTitle: null,
      rawText: TRADITIONAL_CHASE,
    });
    assert.doesNotMatch(output.summary!, /\n/u);
    assert.ok(output.summary!.includes("。"));
  });

  it("E: summary does not invent unsupported facts", () => {
    const output = buildMockKnowledgeOrganizationOutput({
      sourceTitle: null,
      rawText: TRADITIONAL_CHASE,
    });
    const fidelity = assessOrganizerFieldFactFidelity(
      TRADITIONAL_CHASE,
      output.summary ?? "",
    );
    assert.equal(fidelity.ok, true);
    assert.doesNotMatch(output.summary!, /四角清晰|1:1|扫描件/u);
  });

  it("F: English names and numbers preserved", () => {
    const output = buildMockKnowledgeOrganizationOutput({
      sourceTitle: null,
      rawText: TRADITIONAL_CHASE,
    });
    assert.match(output.summary!, /Chase Private Client/u);
    assert.match(output.summary!, /ACH/u);
    assert.match(output.summary!, /15,000|10万/u);
  });

  it("structured builder example for Chase fixture", () => {
    const title = "Chase Private Client 开户资料与资金流动要求";
    const summary = buildStructuredKnowledgeSummaryFromBody({
      title,
      body: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
    });
    assert.ok(summary);
    assert.match(summary!, /护照|身份证/u);
    assert.doesNotMatch(summary!, /以正文为准/u);
  });

  it("deterministic builder uses body only without generic fallback", () => {
    const title = "Chase Private Client 开户资料与资金流动要求";
    const summary = buildDeterministicKnowledgeSummary({
      title,
      body: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      sourceEvidence: TRADITIONAL_CHASE,
    });
    assert.ok(summary);
    assert.equal(isGenericKnowledgeSummaryMeta(summary!), false);
  });
});
