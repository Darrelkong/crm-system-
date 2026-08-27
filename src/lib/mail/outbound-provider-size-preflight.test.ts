import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLOUDFLARE_EMAIL_GENERAL_MESSAGE_LIMIT_BYTES,
  ORDINARY_EMAIL_RAW_ATTACHMENT_AGGREGATE_LIMIT_BYTES,
  OUTBOUND_PROVIDER_SIZE_ERROR_CODES,
} from "@/lib/mail/outbound-provider-size-constants";
import {
  estimateOutboundProviderMessageBytes,
  runOutboundProviderSizePreflight,
  sumDirectAttachmentRawBytes,
} from "@/lib/mail/outbound-provider-size-preflight";

describe("outbound provider size preflight", () => {
  it("allows attachment aggregate below 3 MiB", () => {
    const attachments = [{ sizeBytes: 1024 * 1024, deliveryMode: "direct_attachment" }];
    assert.equal(sumDirectAttachmentRawBytes(attachments), 1024 * 1024);
    const result = runOutboundProviderSizePreflight({
      subject: "Hello",
      text: "Body",
      toCount: 1,
      ccCount: 0,
      bccCount: 0,
      attachments: attachments.map((attachment) => ({
        ...attachment,
        filename: "a.txt",
        mimeType: "text/plain",
      })),
    });
    assert.equal(result.ok, true);
  });

  it("rejects attachment aggregate above 3 MiB", () => {
    const sizeBytes = ORDINARY_EMAIL_RAW_ATTACHMENT_AGGREGATE_LIMIT_BYTES + 1;
    const result = runOutboundProviderSizePreflight({
      subject: "Hello",
      text: "Body",
      toCount: 1,
      ccCount: 0,
      bccCount: 0,
      attachments: [
        {
          sizeBytes,
          filename: "big.bin",
          mimeType: "application/octet-stream",
          deliveryMode: "direct_attachment",
        },
      ],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.code,
        OUTBOUND_PROVIDER_SIZE_ERROR_CODES.ordinaryAttachmentAggregateExceeded,
      );
    }
  });

  it("rejects estimated final total at or above 5 MiB before provider call", () => {
    const body = "x".repeat(4_200_000);
    const estimated = estimateOutboundProviderMessageBytes({
      subject: "Large",
      text: body,
      toCount: 1,
      ccCount: 0,
      bccCount: 0,
      attachments: [
        {
          sizeBytes: 1_200_000,
          filename: "big.bin",
          mimeType: "application/octet-stream",
        },
      ],
    });
    assert.ok(estimated >= CLOUDFLARE_EMAIL_GENERAL_MESSAGE_LIMIT_BYTES);

    const result = runOutboundProviderSizePreflight({
      subject: "Large",
      text: body,
      toCount: 1,
      ccCount: 0,
      bccCount: 0,
      attachments: [
        {
          sizeBytes: 1_200_000,
          filename: "big.bin",
          mimeType: "application/octet-stream",
          deliveryMode: "direct_attachment",
        },
      ],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.code,
        OUTBOUND_PROVIDER_SIZE_ERROR_CODES.messageTooLargeForEmailProvider,
      );
    }
  });

  it("classifies oversize as definitely-not-accepted permanent failure code", () => {
    const result = runOutboundProviderSizePreflight({
      subject: "Large",
      text: "y".repeat(4_200_000),
      toCount: 1,
      ccCount: 0,
      bccCount: 0,
      attachments: [
        {
          sizeBytes: 1_200_000,
          filename: "big.bin",
          mimeType: "application/octet-stream",
          deliveryMode: "direct_attachment",
        },
      ],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.code,
        OUTBOUND_PROVIDER_SIZE_ERROR_CODES.messageTooLargeForEmailProvider,
      );
    }
  });
});
