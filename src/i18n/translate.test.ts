import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { translate } from "@/i18n/translate";
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
