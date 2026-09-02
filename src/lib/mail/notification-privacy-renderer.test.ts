import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NEW_INCOMING_NOTIFICATION_SUBJECT,
  renderNotificationPayload,
} from "@/lib/mail/notification-privacy-renderer";
import {
  formatNotificationReceivedAtLocalized,
  formatNotificationSenderDisplay,
} from "@/lib/mail/notification-new-incoming-context-service";

describe("notification privacy renderer", () => {
  it("uses generic copy for non-incoming types", () => {
    const types = [
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

  it("new incoming without context uses generic fallback", () => {
    const payload = renderNotificationPayload("new_incoming");
    assert.equal(
      payload.bodyText,
      "您在 CRM Mail 收到一封新郵件，請登入查看。",
    );
    assert.equal(payload.subjectText, undefined);
  });

  it("new incoming with context uses privacy-safe metadata only", () => {
    const payload = renderNotificationPayload("new_incoming", {
      mailboxAddress: "daniel.hayes@echfronthk.com",
      senderDisplay: "Sender <sender@external.test>",
      subject: "Production inbound test",
      receivedAtLocalized: "2026/09/02 20:34:04",
    });
    assert.equal(payload.subjectText, NEW_INCOMING_NOTIFICATION_SUBJECT);
    assert.match(payload.bodyText, /工作郵箱：\ndaniel\.hayes@echfronthk\.com/);
    assert.match(payload.bodyText, /寄件人：\nSender <sender@external\.test>/);
    assert.match(payload.bodyText, /主旨：\nProduction inbound test/);
    assert.match(payload.bodyText, /收件時間：\n2026\/09\/02 20:34:04/);
    assert.match(payload.bodyText, /請登入 CRM Mail 查看完整內容及附件。/);
    assert.doesNotMatch(payload.bodyText, /MIME/i);
    assert.doesNotMatch(payload.bodyText, /attachment bytes/i);
  });

  it("formats sender display and localized received time", () => {
    assert.equal(
      formatNotificationSenderDisplay("sender@external.test", "Sender"),
      "Sender <sender@external.test>",
    );
    assert.equal(
      formatNotificationSenderDisplay("sender@external.test", null),
      "sender@external.test",
    );
    const localized = formatNotificationReceivedAtLocalized(
      "2026-09-02T12:34:04.867Z",
    );
    assert.match(localized, /2026/);
    assert.match(localized, /34/);
  });
});
