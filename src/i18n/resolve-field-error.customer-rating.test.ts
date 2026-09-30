import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveFieldError } from "./resolve-api-error";
import { translate } from "./translate";
import en from "./locales/en";
import zhHans from "./locales/zh-Hans";
import zhHant from "./locales/zh-Hant";
import { validateFollowUpInput } from "@/lib/follow-ups/validation";

for (const [locale, messages, expected] of [
  ["en", en, "Choose S / A / B / D"],
  ["zh-Hans", zhHans, "请主动选择 S / A / B / D"],
  ["zh-Hant", zhHant, "請主動選擇 S / A / B / D"],
] as const) {
  describe(`${locale} follow-up field error localization`, () => {
    const t = (key: string) => translate(messages, key);

    it("localizes the actual missing-rating validator error", () => {
      const errors = validateFollowUpInput({
        channel: "phone", outcome: "contact_made", summary: "Synthetic contact notes",
        expectedCustomerRatingRevision: 0,
        nextFollowUpAt: "2026-10-02T00:00:00.000Z",
        nextAction: "Synthetic next action",
      }, { now: new Date("2026-10-01T00:00:00.000Z") });
      assert.equal(errors.length, 1);
      assert.equal(errors[0].code, "CUSTOMER_RATING_REQUIRED");
      const resolved = resolveFieldError(t, errors[0]);
      assert.equal(resolved, expected);
      assert.equal(resolved, t("followUps.chooseRating"));
      assert.notEqual(resolved, errors[0].message);
      if (locale === "en") assert.doesNotMatch(resolved, /\p{Script=Han}/u);
    });

    it("preserves unknown field fallback", () => {
      assert.equal(resolveFieldError(t, {
        field: "unknown", code: "UNMAPPED_TEST_ERROR", message: "Unmapped fallback",
      }), "Unmapped fallback");
    });

    it("preserves the existing follow-up summary mapping", () => {
      assert.equal(resolveFieldError(t, {
        field: "summary", code: "FOLLOW_UP_SUMMARY_REQUIRED", message: "跟进内容摘要必填",
      }), t("errors.followUpSummaryRequired"));
    });
  });
}
