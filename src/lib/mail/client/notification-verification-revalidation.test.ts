import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("notification verification revalidation stability", () => {
  it("keeps background session revalidation out of the initial loading state", () => {
    const provider = read("src/lib/mail/client/mail-session-provider.tsx");

    assert.match(provider, /refresh: \(options\?: \{ background\?: boolean \}\)/);
    assert.match(provider, /options\.background \?\? sessionRef\.current !== null/);
    assert.match(provider, /if \(!background\) \{\s*setLoading\(true\);/);
    assert.match(provider, /refresh\(\{ background: true \}\)/);
    assert.match(provider, /if \(!background \|\| accessDisabled\)/);
  });

  it("uses silent refreshes for notification identity updates", () => {
    const control = read(
      "src/components/mail/admin/notification-identity-control-view.tsx",
    );
    const mailAccess = read("src/components/mail/admin/mail-access-management.tsx");
    const teamOverview = read(
      "src/components/mail/admin/notification-identity-team-overview.tsx",
    );

    assert.match(control, /load\(\{ background: true \}\)/);
    assert.match(control, /if \(!background\) \{\s*setLoading\(true\);/);
    assert.match(mailAccess, /onUpdated=\{\(\) => void load\(\{ background: true \}\)\}/);
    assert.match(teamOverview, /void load\(\{ background: true \}\)/);
    assert.match(teamOverview, /onPendingUpdated=\{handleReload\}/);
  });

  it("keeps OTP feedback and modal open on verification failure", () => {
    const otp = read(
      "src/components/mail/admin/notification-identity-otp-modal.tsx",
    );
    const failureStart = otp.indexOf("if (!result.ok)");
    const successStart = otp.indexOf(
      'setFeedback(t("mail.adminCenter.notificationIdentity.verifySuccess"))',
    );
    assert.ok(failureStart >= 0);
    assert.ok(successStart > failureStart);

    const failurePath = otp.slice(failureStart, successStart);
    assert.match(failurePath, /setFeedback\(resolveFeedback/);
    assert.match(failurePath, /onPendingUpdated\(\)/);
    assert.doesNotMatch(failurePath, /onClose\(\)/);
  });

  it("keeps resend feedback in the OTP modal", () => {
    const otp = read(
      "src/components/mail/admin/notification-identity-otp-modal.tsx",
    );
    const resendStart = otp.indexOf("async function handleSendVerification");
    const verifyStart = otp.indexOf("async function handleVerify");
    assert.ok(resendStart >= 0 && verifyStart > resendStart);

    const resendPath = otp.slice(resendStart, verifyStart);
    assert.match(resendPath, /setFeedback\(/);
    assert.match(resendPath, /onPendingUpdated\(\)/);
    assert.doesNotMatch(resendPath, /onClose\(\)/);
  });

  it("refreshes the session endpoint through the canonical disabled-access event", () => {
    const api = read("src/lib/mail/client/api.ts");
    assert.match(api, /isMailAccessDisabledError\(\{/);
    assert.match(api, /notifyMailAccessDisabled\(\)/);
  });
});
