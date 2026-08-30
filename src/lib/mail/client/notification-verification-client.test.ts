import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import zhHant from "@/i18n/locales/zh-Hant";
import zhHans from "@/i18n/locales/zh-Hans";
import { translate } from "@/i18n/translate";
import {
  VERIFICATION_CODE_INPUT_PROPS,
  formatVerificationResendActionLabel,
  normalizeVerificationCodeFieldValue,
  parseNotificationVerificationErrorMetadata,
  resolveNotificationVerificationErrorMessage,
} from "@/lib/mail/client/notification-verification-client";

describe("notification verification client UX", () => {
  it("limits verification input to 8 characters", () => {
    assert.equal(VERIFICATION_CODE_INPUT_PROPS.maxLength, 8);
    assert.equal(
      normalizeVerificationCodeFieldValue("ABCDEFGHXYZ"),
      "ABCDEFGH",
    );
  });

  it("configures one-time-code autocomplete and uppercase entry", () => {
    assert.equal(VERIFICATION_CODE_INPUT_PROPS.autoComplete, "one-time-code");
    assert.equal(VERIFICATION_CODE_INPUT_PROPS.autoCapitalize, "characters");
    assert.equal(VERIFICATION_CODE_INPUT_PROPS.spellCheck, false);
  });

  it("localizes resend cooldown errors in zh-Hans", () => {
    assert.equal(
      resolveNotificationVerificationErrorMessage(
        (key, params) => translate(zhHans, key, params),
        parseNotificationVerificationErrorMetadata({
          verificationReason: "resend_cooldown",
          retryAfterSeconds: 59,
        }),
      ),
      "请在 59 秒后重新发送。",
    );
  });

  it("localizes remaining-attempt and cooldown messages in zh-Hant", () => {
    assert.equal(
      resolveNotificationVerificationErrorMessage(
        (key, params) => translate(zhHant, key, params),
        parseNotificationVerificationErrorMetadata({
          verificationReason: "invalid_code",
          remainingAttempts: 2,
        }),
      ),
      "驗證碼不正確，還可嘗試 2 次。",
    );
    assert.equal(
      resolveNotificationVerificationErrorMessage(
        (key, params) => translate(zhHant, key, params),
        parseNotificationVerificationErrorMetadata({
          verificationReason: "resend_cooldown",
          retryAfterSeconds: 59,
        }),
      ),
      "請在 59 秒後重新發送。",
    );
    assert.equal(
      formatVerificationResendActionLabel(
        (key, params) => translate(zhHant, key, params),
        59,
      ),
      "重新發送（59s）",
    );
  });

  it("uses viewport-centered modal geometry on mobile", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const modal = readFileSync("src/components/ui/modal.tsx", "utf8");
    const otpModal = readFileSync(
      "src/components/mail/admin/notification-identity-otp-modal.tsx",
      "utf8",
    );
    assert.match(css, /place-items:\s*center/);
    assert.match(css, /100dvh/);
    assert.match(css, /safe-area-inset/);
    assert.match(css, /\.modal-panel-body/);
    assert.match(modal, /document\.body/);
    assert.match(otpModal, /modal-panel-body/);
    assert.match(otpModal, /VERIFICATION_CODE_INPUT_PROPS/);
  });
});
