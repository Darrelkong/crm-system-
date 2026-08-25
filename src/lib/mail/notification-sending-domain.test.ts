import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAIL_NOTIFICATION_SENDING_DOMAIN,
  MAIL_NOTIFICATION_SENDING_FROM_ADDRESS,
} from "@/lib/mail/notification-sending-domain";

describe("notification sending domain constants", () => {
  it("exposes the frozen notification sending domain", () => {
    assert.equal(MAIL_NOTIFICATION_SENDING_DOMAIN, "send.echfronthk.com");
    assert.equal(
      MAIL_NOTIFICATION_SENDING_FROM_ADDRESS,
      "notifications@send.echfronthk.com",
    );
    assert.ok(
      MAIL_NOTIFICATION_SENDING_FROM_ADDRESS.endsWith(
        `@${MAIL_NOTIFICATION_SENDING_DOMAIN}`,
      ),
    );
  });
});
