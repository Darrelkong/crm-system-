import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeContactIdentifier,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  normalizeCustomerWechat,
  normalizePhoneCountryCode,
  normalizePhoneNationalNumber,
} from "./contact-normalization";

describe("contact-normalization phone", () => {
  it("matches the same +86 number with spaces, parens, and hyphens", () => {
    const a = normalizeCustomerPhone("+86", "13800138000");
    const b = normalizeCustomerPhone("+86", "138 0013 8000");
    const c = normalizeCustomerPhone("+86", "(138)0013-8000");
    const d = normalizeCustomerPhone("+86", "（138）0013-8000");
    assert.equal(a, "+8613800138000");
    assert.equal(b, a);
    assert.equal(c, a);
    assert.equal(d, a);
    assert.equal(normalizeCustomerPhone("+86", "138-0013-8000"), a);
  });

  it("treats same national digits under different country codes as different", () => {
    const cn = normalizeCustomerPhone("+86", "13800138000");
    const us = normalizeCustomerPhone("+1", "13800138000");
    assert.equal(cn, "+8613800138000");
    assert.equal(us, "+113800138000");
    assert.notEqual(cn, us);
  });

  it("does not match by trailing digits alone", () => {
    const full = normalizeCustomerPhone("+86", "13800138000");
    const tail = normalizeCustomerPhone("+86", "00138000");
    assert.notEqual(full, tail);
  });

  it("does not invent a country code when missing", () => {
    assert.equal(normalizeCustomerPhone(null, "13800138000"), null);
    assert.equal(normalizeCustomerPhone("", "13800138000"), null);
    assert.equal(normalizeCustomerPhone("  ", "13800138000"), null);
  });

  it("normalizes country code to +digits", () => {
    assert.equal(normalizePhoneCountryCode("86"), "+86");
    assert.equal(normalizePhoneCountryCode("+086"), "+086");
    assert.equal(normalizePhoneNationalNumber(" 138 0013-8000 "), "13800138000");
  });
});

describe("contact-normalization wechat", () => {
  it("matches WeChat ids case-insensitively", () => {
    assert.equal(
      normalizeCustomerWechat("Daniel_ABC"),
      normalizeCustomerWechat("daniel_abc"),
    );
    assert.equal(normalizeCustomerWechat("Daniel_ABC"), "daniel_abc");
  });

  it("preserves hyphens and underscores", () => {
    assert.equal(normalizeCustomerWechat("wx-user_01"), "wx-user_01");
  });
});

describe("contact-normalization email", () => {
  it("trims and lowercases", () => {
    assert.equal(
      normalizeCustomerEmail("  Foo.Bar+tag@Example.COM "),
      "foo.bar+tag@example.com",
    );
  });

  it("does not strip Gmail dots or plus aliases", () => {
    assert.equal(
      normalizeCustomerEmail("a.b+c@gmail.com"),
      "a.b+c@gmail.com",
    );
    assert.notEqual(
      normalizeCustomerEmail("ab@gmail.com"),
      normalizeCustomerEmail("a.b@gmail.com"),
    );
  });
});

describe("normalizeContactIdentifier", () => {
  it("dispatches by type", () => {
    assert.equal(
      normalizeContactIdentifier("phone", "13800138000", "+86"),
      "+8613800138000",
    );
    assert.equal(normalizeContactIdentifier("wechatId", "Wx_1"), "wx_1");
    assert.equal(
      normalizeContactIdentifier("email", "A@B.com"),
      "a@b.com",
    );
  });
});
