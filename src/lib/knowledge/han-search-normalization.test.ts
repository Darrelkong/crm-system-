import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandHanSearchToken, expandHanSearchVariants } from "@/lib/knowledge/han-search-normalization";

describe("Knowledge Han search normalization", () => {
  it("expands simplified and traditional Chinese variants bidirectionally", () => {
    const simplified = expandHanSearchVariants("开户目的");
    assert.ok(simplified.includes("开户目的"));
    assert.ok(simplified.includes("開戶目的"));

    const traditional = expandHanSearchVariants("開戶目的");
    assert.ok(traditional.includes("开户目的"));
    assert.ok(traditional.includes("開戶目的"));
  });

  it("expands common financial and workflow terms", () => {
    for (const [left, right] of [
      ["银行", "銀行"],
      ["审核", "審核"],
      ["资料", "資料"],
    ]) {
      const leftVariants = expandHanSearchToken(left);
      const rightVariants = expandHanSearchToken(right);
      assert.ok(leftVariants.includes(left));
      assert.ok(leftVariants.includes(right));
      assert.ok(rightVariants.includes(left));
      assert.ok(rightVariants.includes(right));
    }
    const accountVariants = expandHanSearchToken("账户");
    assert.ok(accountVariants.includes("账户"));
    assert.ok(accountVariants.includes("賬戶"));
    const publishVariants = expandHanSearchToken("发布");
    assert.ok(publishVariants.includes("发布"));
    assert.ok(publishVariants.some((variant) => variant.includes("發")));
  });

  it("leaves non-Han tokens unchanged", () => {
    assert.deepEqual(expandHanSearchToken("alpha"), ["alpha"]);
    assert.deepEqual(expandHanSearchToken("123"), ["123"]);
  });
});
