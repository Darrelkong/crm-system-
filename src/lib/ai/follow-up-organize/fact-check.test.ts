import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { passesFollowUpOrganizeFactCheck } from "@/lib/ai/follow-up-organize/fact-check";
import {
  safeParseFollowUpOrganizeAiOutput,
} from "@/lib/ai/follow-up-organize/schema";

function validAi(overrides: Record<string, unknown> = {}) {
  return {
    organizedText: "客戶表示有興趣，下一步發送方案。",
    extracted: {
      businessNeed: "方案",
      concerns: [],
      documentStatus: [],
      agreedFollowUpAt: null,
      nextAction: "發送方案",
    },
    warnings: [],
    ...overrides,
  };
}

describe("follow-up organize AI schema", () => {
  it("accepts valid output", () => {
    const parsed = safeParseFollowUpOrganizeAiOutput(validAi());
    assert.equal(parsed.success, true);
  });

  it("rejects missing fields and unknown top-level keys under strict schema", () => {
    assert.equal(
      safeParseFollowUpOrganizeAiOutput({ organizedText: "x" }).success,
      false,
    );
  });

  it("rejects empty organizedText and oversized concerns", () => {
    assert.equal(
      safeParseFollowUpOrganizeAiOutput(validAi({ organizedText: "" })).success,
      false,
    );
    assert.equal(
      safeParseFollowUpOrganizeAiOutput(
        validAi({
          extracted: {
            businessNeed: null,
            concerns: Array.from({ length: 11 }, (_, i) => `c${i}`),
            documentStatus: [],
            agreedFollowUpAt: null,
            nextAction: null,
          },
        }),
      ).success,
      false,
    );
  });
});

describe("fact preservation", () => {
  it("rejects newly introduced phone/email/amount/date/percent", () => {
    const original = "客戶可能有興趣，下一步再聯絡。";
    assert.equal(
      passesFollowUpOrganizeFactCheck(
        original,
        validAi({
          organizedText: "客戶可能有興趣，電話 +852 9999 8888。",
        }) as never,
      ),
      false,
    );
    assert.equal(
      passesFollowUpOrganizeFactCheck(
        original,
        validAi({
          organizedText: "客戶可能有興趣，email new@x.com。",
        }) as never,
      ),
      false,
    );
    assert.equal(
      passesFollowUpOrganizeFactCheck(
        original,
        validAi({
          organizedText: "客戶可能有興趣，預算 HK$99,000。",
        }) as never,
      ),
      false,
    );
    assert.equal(
      passesFollowUpOrganizeFactCheck(
        original,
        validAi({
          organizedText: "客戶可能有興趣，2026-09-01 成交。",
        }) as never,
      ),
      false,
    );
    assert.equal(
      passesFollowUpOrganizeFactCheck(
        original,
        validAi({
          organizedText: "客戶可能有興趣，成功率 90%。",
        }) as never,
      ),
      false,
    );
  });

  it("allows facts that exist in the original text", () => {
    const original =
      "電話 +852 9123 4567，預算 HK$12,000，約 2026-08-01，成功率 30%。客戶可能有興趣。";
    assert.equal(
      passesFollowUpOrganizeFactCheck(
        original,
        validAi({
          organizedText:
            "客戶可能有興趣。電話 +852 9123 4567，預算 HK$12,000，約 2026-08-01，成功率 30%。",
        }) as never,
      ),
      true,
    );
  });

  it("rejects certainty upgrades from soft to hard language", () => {
    const original = "客戶可能有興趣，考慮一下。";
    assert.equal(
      passesFollowUpOrganizeFactCheck(
        original,
        validAi({
          organizedText: "客戶已決定，有強烈意向。",
        }) as never,
      ),
      false,
    );
  });

  it("rejects newly introduced named persons", () => {
    const original = "客戶可能有興趣，下一步再聯絡。";
    assert.equal(
      passesFollowUpOrganizeFactCheck(
        original,
        validAi({
          organizedText: "與 John Smith 會面後，下一步再聯絡。",
        }) as never,
      ),
      false,
    );
    assert.equal(
      passesFollowUpOrganizeFactCheck(
        original,
        validAi({
          organizedText: "與王經理會面後，下一步再聯絡。",
        }) as never,
      ),
      false,
    );
  });

  it("rejects HTML and unknown top-level schema fields", () => {
    assert.equal(
      safeParseFollowUpOrganizeAiOutput(
        validAi({ organizedText: "<script>alert(1)</script>" }),
      ).success,
      false,
    );
    assert.equal(
      safeParseFollowUpOrganizeAiOutput({
        ...validAi(),
        extra: "nope",
      }).success,
      false,
    );
  });
});
