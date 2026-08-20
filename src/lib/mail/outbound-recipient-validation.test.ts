import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailServiceError } from "@/lib/mail/errors";
import {
  MAX_OUTBOUND_RECIPIENTS,
  normalizeOutboundRecipients,
} from "@/lib/mail/outbound-recipient-validation";

describe("outbound recipient validation", () => {
  it("accepts one recipient", () => {
    const rows = normalizeOutboundRecipients([
      { recipientType: "to", address: "client@example.com" },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.address, "client@example.com");
  });

  it("rejects duplicate addresses across types", () => {
    assert.throws(
      () =>
        normalizeOutboundRecipients([
          { recipientType: "to", address: "client@example.com" },
          { recipientType: "cc", address: "CLIENT@example.com" },
        ]),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("preserves plus-tag addresses", () => {
    const rows = normalizeOutboundRecipients([
      { recipientType: "to", address: "user+tag@example.com" },
    ]);
    assert.equal(rows[0]?.address, "user+tag@example.com");
  });

  it("rejects more than 50 recipients", () => {
    const recipients = Array.from({ length: MAX_OUTBOUND_RECIPIENTS + 1 }, (_, i) => ({
      recipientType: "to" as const,
      address: `user${i}@example.com`,
    }));
    assert.throws(
      () => normalizeOutboundRecipients(recipients),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });
});
