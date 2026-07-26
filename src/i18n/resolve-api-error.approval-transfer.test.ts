import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveApiError,
  resolveFieldError,
} from "@/i18n/resolve-api-error";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

function lookup(messages: unknown, key: string): string {
  const parts = key.split(".");
  let cur: unknown = messages;
  for (const part of parts) {
    if (!cur || typeof cur !== "object" || !(part in cur)) {
      return key;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : key;
}

function tFor(messages: unknown) {
  return (key: string) => lookup(messages, key);
}

const TRANSFER_MESSAGES = [
  {
    chinese: "转移目标员工必填",
    key: "errors.transferTargetRequired",
  },
  {
    chinese: "转移申请缺少目标员工",
    key: "errors.transferTargetRequired",
  },
  {
    chinese: "目标员工无效",
    key: "errors.transferTargetInvalid",
  },
  {
    chinese: "目标员工不能与当前负责人相同",
    key: "errors.transferTargetSameAsOwner",
  },
] as const;

describe("approval transfer staff Chinese message mapping", () => {
  for (const { chinese, key } of TRANSFER_MESSAGES) {
    it(`resolveApiError maps "${chinese}"`, () => {
      const tEn = tFor(en);
      const tHans = tFor(zhHans);
      const tHant = tFor(zhHant);

      assert.equal(resolveApiError(tEn, { error: chinese }), tEn(key));
      assert.equal(resolveApiError(tHans, { error: chinese }), tHans(key));
      assert.equal(resolveApiError(tHant, { error: chinese }), tHant(key));
      assert.equal(resolveApiError(tEn, chinese), tEn(key));

      assert.notEqual(resolveApiError(tEn, { error: chinese }), chinese);
      assert.notEqual(resolveApiError(tHans, { error: chinese }), chinese);
      assert.notEqual(resolveApiError(tHant, { error: chinese }), chinese);
      assert.equal(tEn(key).includes("staff"), false);
      assert.equal(tHans(key).includes("员工"), false);
      assert.equal(tHant(key).includes("員工"), false);
    });

    it(`resolveFieldError maps "${chinese}"`, () => {
      const tEn = tFor(en);
      const tHans = tFor(zhHans);
      const tHant = tFor(zhHant);
      const field = { field: "targetUserId", message: chinese };

      assert.equal(resolveFieldError(tEn, field), tEn(key));
      assert.equal(resolveFieldError(tHans, field), tHans(key));
      assert.equal(resolveFieldError(tHant, field), tHant(key));
      assert.notEqual(resolveFieldError(tEn, field), chinese);
    });
  }

  it("keeps three-locale keys for transfer target errors", () => {
    assert.equal(typeof en.errors.transferTargetRequired, "string");
    assert.equal(typeof en.errors.transferTargetInvalid, "string");
    assert.equal(typeof en.errors.transferTargetSameAsOwner, "string");
    assert.equal(typeof zhHans.errors.transferTargetRequired, "string");
    assert.equal(typeof zhHans.errors.transferTargetInvalid, "string");
    assert.equal(typeof zhHans.errors.transferTargetSameAsOwner, "string");
    assert.equal(typeof zhHant.errors.transferTargetRequired, "string");
    assert.equal(typeof zhHant.errors.transferTargetInvalid, "string");
    assert.equal(typeof zhHant.errors.transferTargetSameAsOwner, "string");
  });

  it("preserves unknown Chinese fallback for resolveApiError", () => {
    const tEn = tFor(en);
    const unknown = "这是一条未映射的错误";
    assert.equal(resolveApiError(tEn, { error: unknown }), unknown);
  });

  it("preserves unknown field message fallback for resolveFieldError", () => {
    const tEn = tFor(en);
    const unknown = "这是一条未映射的字段错误";
    assert.equal(
      resolveFieldError(tEn, { field: "targetUserId", message: unknown }),
      unknown,
    );
  });

  it("still prefers errorCode over Chinese message", () => {
    const tEn = tFor(en);
    assert.equal(
      resolveApiError(tEn, {
        error: "转移目标员工必填",
        errorCode: "APPROVAL_NOT_FOUND",
      }),
      tEn("errors.approvalNotFound"),
    );
  });
});
