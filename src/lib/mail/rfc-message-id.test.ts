import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateRfcMessageId,
  isValidRfcMessageIdFormat,
} from "@/lib/mail/rfc-message-id";
import { MAIL_RFC_MESSAGE_ID_DOMAIN } from "@/lib/mail/constants";

describe("rfc message-id v1", () => {
  it("generates valid RFC Message-ID under company domain", () => {
    const id = generateRfcMessageId();
    assert.ok(isValidRfcMessageIdFormat(id));
    assert.ok(id.endsWith(`@${MAIL_RFC_MESSAGE_ID_DOMAIN}>`));
    assert.ok(!id.includes("client@"));
  });

  it("generates unique values", () => {
    const a = generateRfcMessageId();
    const b = generateRfcMessageId();
    assert.notEqual(a, b);
  });
});
