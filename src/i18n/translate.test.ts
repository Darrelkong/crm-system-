import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { translate } from "@/i18n/translate";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

describe("translate message count interpolation", () => {
  it("renders numeric counts for mail list messageCount", () => {
    assert.equal(
      translate(zhHant, "mail.list.messageCount", { count: "0" }),
      "0 封郵件",
    );
    assert.equal(
      translate(zhHant, "mail.list.messageCount", { count: "1" }),
      "1 封郵件",
    );
    assert.equal(
      translate(zhHant, "mail.list.messageCount", { count: "8" }),
      "8 封郵件",
    );
  });
});

for (const [locale, catalog] of [["en", en], ["zh-Hans", zhHans], ["zh-Hant", zhHant]] as const) {
  describe(`${locale} rating history runtime interpolation`, () => {
    for (const [key, token, value] of [
      ["historyMaintained", "rating", "S"],
      ["historyRecordedAt", "time", "2026-09-30 15:42"],
      ["historyReason", "reason", "Synthetic human decision"],
    ] as const) {
      it(`interpolates customerRating.${key} without literal placeholders`, () => {
        const text = translate(catalog, `customerRating.${key}`, { [token]: value });
        assert.ok(text.includes(value));
        assert.doesNotMatch(text, /\{\{?(?:rating|time|reason)\}\}?/);
      });
    }
  });
}
