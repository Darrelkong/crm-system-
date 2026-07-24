import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPhase2ContextFromPlain,
  clipEvidenceExcerpt,
  maskEvidenceExcerpt,
  validateEvidenceReference,
} from "@/lib/ai/phase2";

function ctx() {
  return buildPhase2ContextFromPlain({
    customerId: "c1",
    salesStage: "qualified",
    requestedProjectName: "香港身份",
    initialNote: "客户关心费用和时间，也提到资料准备",
    createdAt: "2026-07-01T00:00:00.000Z",
    recentFollowUps: [
      {
        id: "fu-1",
        followUpTime: "2026-07-10T00:00:00.000Z",
        summary: "客户说费用有点高，想再比较",
        nextAction: "发送费用说明",
        outcome: "replied",
      },
    ],
  });
}

describe("phase2 evidence", () => {
  it("accepts follow-up evidence with normalized excerpt", () => {
    const result = validateEvidenceReference(
      {
        sourceType: "follow_up",
        sourceId: "fu-1",
        occurredAt: "2026-07-10T00:00:00.000Z",
        excerpt: "费用有点高，想再比较",
        field: null,
      },
      ctx(),
    );
    assert.equal(result.ok, true);
  });

  it("rejects unknown follow-up id and invented excerpt", () => {
    assert.equal(
      validateEvidenceReference(
        {
          sourceType: "follow_up",
          sourceId: "fu-other-customer",
          occurredAt: null,
          excerpt: "费用有点高",
          field: null,
        },
        ctx(),
      ).ok,
      false,
    );
    assert.equal(
      validateEvidenceReference(
        {
          sourceType: "follow_up",
          sourceId: "fu-1",
          occurredAt: null,
          excerpt: "客户承诺下周签约",
          field: null,
        },
        ctx(),
      ).ok,
      false,
    );
  });

  it("validates initial note and customer field whitelist", () => {
    assert.equal(
      validateEvidenceReference(
        {
          sourceType: "initial_note",
          sourceId: "initial_note",
          occurredAt: null,
          excerpt: "客户关心费用和时间",
          field: null,
        },
        ctx(),
      ).ok,
      true,
    );
    assert.equal(
      validateEvidenceReference(
        {
          sourceType: "customer_field",
          sourceId: null,
          occurredAt: null,
          excerpt: "香港身份",
          field: "requested_project_name",
        },
        ctx(),
      ).ok,
      true,
    );
    assert.equal(
      validateEvidenceReference(
        {
          sourceType: "customer_field",
          sourceId: null,
          occurredAt: null,
          excerpt: "secret",
          field: "phone",
        },
        ctx(),
      ).ok,
      false,
    );
  });

  it("validates system rule codes and clips excerpt length", () => {
    assert.equal(
      validateEvidenceReference(
        {
          sourceType: "system_rule",
          sourceId: "RULE_INTERACTION_COUNT",
          occurredAt: null,
          excerpt: "recent_follow_ups=1",
          field: null,
        },
        ctx(),
      ).ok,
      true,
    );
    assert.equal(
      validateEvidenceReference(
        {
          sourceType: "system_rule",
          sourceId: "bad",
          occurredAt: null,
          excerpt: "x",
          field: null,
        },
        ctx(),
      ).ok,
      false,
    );
    assert.equal(clipEvidenceExcerpt("a".repeat(200)).length, 160);
  });

  it("masks sensitive tokens without removing ordinary dates/amounts labels incorrectly", () => {
    const masked = maskEvidenceExcerpt(
      "电话 +86 138 0000 1234，邮箱 a@b.com，微信: wx_user_01，账号 6222021234567890123，日期 2026-07-20，费用约 3 万",
    );
    assert.match(masked, /\[phone\]/);
    assert.match(masked, /\[email\]/);
    assert.match(masked, /\[wechat\]/);
    assert.match(masked, /\[account\]/);
    assert.match(masked, /2026-07-20/);
    assert.match(masked, /3 万/);
  });

  it("validates excerpt against raw source before masking", () => {
    const result = validateEvidenceReference(
      {
        sourceType: "follow_up",
        sourceId: "fu-1",
        occurredAt: null,
        excerpt: "费用有点高，想再比较",
        field: null,
      },
      ctx(),
    );
    assert.equal(result.ok, true);
    // Invented phone-looking text that would only "match" after aggressive masking
    // of source is still rejected because validation uses the raw source.
    assert.equal(
      validateEvidenceReference(
        {
          sourceType: "follow_up",
          sourceId: "fu-1",
          occurredAt: null,
          excerpt: "客户承诺签约电话 +86 138 0000 9999",
          field: null,
        },
        ctx(),
      ).ok,
      false,
    );
  });
});
