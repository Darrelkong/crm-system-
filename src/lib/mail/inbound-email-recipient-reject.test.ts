import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InboundEmailIngressError,
} from "@/lib/mail/cloudflare-email-inbound-adapter";
import {
  INBOUND_EMAIL_RECIPIENT_REJECT_REASON,
  isInboundRecipientRejectIngressError,
  rejectInboundEmailRecipient,
} from "@/lib/mail/inbound-email-recipient-reject";

describe("inbound email recipient reject", () => {
  it("classifies deterministic recipient-invalid ingress errors", () => {
    assert.equal(
      isInboundRecipientRejectIngressError(
        new InboundEmailIngressError("UNKNOWN_RECIPIENT", "Envelope recipient cannot be accepted"),
      ),
      true,
    );
    assert.equal(
      isInboundRecipientRejectIngressError(
        new InboundEmailIngressError(
          "RECIPIENT_NOT_ACCEPTABLE",
          "Envelope recipient cannot be accepted",
        ),
      ),
      true,
    );
    assert.equal(
      isInboundRecipientRejectIngressError(
        new InboundEmailIngressError(
          "MISSING_ENVELOPE_RECIPIENT",
          "Cloudflare envelope recipient (message.to) is required",
        ),
      ),
      true,
    );
  });

  it("does not classify infrastructure or staging failures as recipient reject", () => {
    assert.equal(
      isInboundRecipientRejectIngressError(
        new InboundEmailIngressError("MIME_TOO_LARGE", "Inbound MIME exceeds limit"),
      ),
      false,
    );
    assert.equal(
      isInboundRecipientRejectIngressError(
        new InboundEmailIngressError("EMPTY_RAW_MIME", "Inbound raw MIME is empty"),
      ),
      false,
    );
    assert.equal(
      isInboundRecipientRejectIngressError(
        new InboundEmailIngressError(
          "STAGING_NOT_ACK_SAFE",
          "Inbound provider event was not durably staged",
        ),
      ),
      false,
    );
    assert.equal(isInboundRecipientRejectIngressError(new Error("D1 unavailable")), false);
  });

  it("calls setReject once with a generic safe reason", () => {
    let rejectCount = 0;
    let rejectReason: string | undefined;
    const message = {
      setReject(reason: string) {
        rejectCount += 1;
        rejectReason = reason;
      },
    };

    const rejected = rejectInboundEmailRecipient(
      message,
      new InboundEmailIngressError("UNKNOWN_RECIPIENT", "Envelope recipient cannot be accepted"),
    );

    assert.equal(rejected, true);
    assert.equal(rejectCount, 1);
    assert.equal(rejectReason, INBOUND_EMAIL_RECIPIENT_REJECT_REASON);
    assert.doesNotMatch(rejectReason ?? "", /@|mailbox|user|admin|notification/i);
  });

  it("does not call setReject when setReject is unavailable", () => {
    const rejected = rejectInboundEmailRecipient(
      {},
      new InboundEmailIngressError("UNKNOWN_RECIPIENT", "Envelope recipient cannot be accepted"),
    );
    assert.equal(rejected, false);
  });
});
