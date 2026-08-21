import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderNotificationPayload } from "@/lib/mail/notification-privacy-renderer";

describe("notification privacy renderer", () => {
  it("uses generic copy only for all V1 types", () => {
    const types = [
      "new_incoming",
      "approval_returned",
      "shared_assigned",
      "important_send_failure",
    ] as const;

    for (const notificationType of types) {
      const payload = renderNotificationPayload(notificationType);
      assert.equal(payload.brandName, "ECHFRONT CRM Mail");
      assert.match(payload.bodyText, /CRM Mail/);
      assert.doesNotMatch(payload.bodyText, /Subject:/i);
      assert.doesNotMatch(payload.bodyText, /@/);
      assert.doesNotMatch(JSON.stringify(payload), /attachment/i);
      assert.doesNotMatch(JSON.stringify(payload), /customer/i);
      assert.doesNotMatch(JSON.stringify(payload), /Bcc/i);
    }
  });

  it("new incoming copy is privacy-preserving", () => {
    const payload = renderNotificationPayload("new_incoming");
    assert.equal(
      payload.bodyText,
      "您在 CRM Mail 收到一封新郵件，請登入查看。",
    );
  });
});
