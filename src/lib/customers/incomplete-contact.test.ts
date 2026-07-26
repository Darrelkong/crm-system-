import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getIncompleteContactKind } from "./incomplete-contact";

describe("getIncompleteContactKind", () => {
  it("returns null when both phone and wechat are present", () => {
    assert.equal(getIncompleteContactKind("13800138000", "wx_user"), null);
  });

  it("returns wechat when only phone is present", () => {
    assert.equal(getIncompleteContactKind("13800138000", ""), "wechat");
    assert.equal(getIncompleteContactKind("13800138000", "   "), "wechat");
  });

  it("returns phone when only wechat is present", () => {
    assert.equal(getIncompleteContactKind("", "wx_user"), "phone");
    assert.equal(getIncompleteContactKind("  ", "wx_user"), "phone");
  });

  it("returns null when both are empty (validation owns this case)", () => {
    assert.equal(getIncompleteContactKind("", ""), null);
    assert.equal(getIncompleteContactKind(null, undefined), null);
  });
});
