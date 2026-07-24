import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { organizeFollowUpTextBasic } from "@/lib/ai/follow-up-organize/basic";

describe("organizeFollowUpTextBasic", () => {
  it("trims and collapses spaces/newlines without inventing content", () => {
    const input = "  客戶說  有興趣\n\n\n明天再聯絡  ";
    const result = organizeFollowUpTextBasic(input, {
      nowIso: "2026-07-20T04:00:00.000Z",
    });
    assert.equal(result.source, "basic_rules");
    assert.equal(result.originalText, input);
    assert.equal(result.organizedText.includes("  "), false);
    assert.equal(result.organizedText.includes("\n\n\n"), false);
    assert.ok(result.organizedText.includes("客戶說"));
  });

  it("preserves phone, email, url, and amounts", () => {
    const input =
      "電話 +852 9123 4567，email a@b.com，見 https://example.com ，預算 HK$12,000。";
    const result = organizeFollowUpTextBasic(input);
    assert.ok(result.organizedText.includes("+852 9123 4567"));
    assert.ok(result.organizedText.includes("a@b.com"));
    assert.ok(result.organizedText.includes("https://example.com"));
    assert.ok(result.organizedText.includes("HK$12,000"));
  });

  it("detects explicit dates and ambiguous date warnings", () => {
    const explicit = organizeFollowUpTextBasic(
      "客戶說 2026-08-01 再聯絡，下一步發送資料。",
    );
    assert.equal(explicit.extracted.agreedFollowUpAt?.isoCandidate, "2026-08-01");

    const ambiguous = organizeFollowUpTextBasic("客戶說下週再聯絡。");
    assert.ok(ambiguous.warnings.some((w) => w.code === "AMBIGUOUS_DATE"));
    assert.equal(ambiguous.extracted.agreedFollowUpAt, null);
  });

  it("warns on short text and missing next-action language", () => {
    const short = organizeFollowUpTextBasic("好的");
    assert.ok(short.warnings.some((w) => w.code === "TEXT_TOO_SHORT"));
    assert.ok(short.warnings.some((w) => w.code === "NEXT_ACTION_MISSING"));
  });

  it("is deterministic and does not mutate input", () => {
    const input = "跟進：客戶可能有興趣。下一步回電。";
    const snapshot = input;
    const a = organizeFollowUpTextBasic(input, {
      nowIso: "2026-07-20T04:00:00.000Z",
    });
    const b = organizeFollowUpTextBasic(input, {
      nowIso: "2026-07-20T04:00:00.000Z",
    });
    assert.deepEqual(a, b);
    assert.equal(input, snapshot);
  });

  it("rejects empty and too-long inputs safely", () => {
    const empty = organizeFollowUpTextBasic("   ");
    assert.ok(empty.warnings.some((w) => w.code === "INPUT_EMPTY"));
    const long = "字".repeat(5001);
    const tooLong = organizeFollowUpTextBasic(long);
    assert.ok(tooLong.warnings.some((w) => w.code === "INPUT_TOO_LONG"));
    assert.equal(tooLong.organizedText, long);
  });
});
