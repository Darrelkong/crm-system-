import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { organizeFollowUpTextBasic } from "@/lib/ai/follow-up-organize/basic";

describe("organizeFollowUpTextBasic extended safety", () => {
  it("preserves mixed-language content, emoji, and list newlines", () => {
    const input =
      "客户说 interested in project\n- 需求A\n- 需求B\n😊 下一步发送资料";
    const result = organizeFollowUpTextBasic(input);
    assert.ok(result.organizedText.includes("interested"));
    assert.ok(result.organizedText.includes("😊"));
    assert.ok(result.organizedText.includes("需求A"));
    assert.equal(result.source, "basic_rules");
  });

  it("does not convert traditional/simplified characters", () => {
    const hant = "客戶考慮一下，下一步跟進。";
    const hans = "客户考虑一下，下一步跟进。";
    assert.ok(organizeFollowUpTextBasic(hant).organizedText.includes("客戶"));
    assert.ok(organizeFollowUpTextBasic(hans).organizedText.includes("客户"));
  });

  it("keeps bank-like digit runs intact while cleaning spaces", () => {
    const input = "账号  6222 0000 1111 2222 ，下一步核对。";
    const result = organizeFollowUpTextBasic(input);
    assert.ok(result.organizedText.includes("6222 0000 1111 2222"));
  });
});
