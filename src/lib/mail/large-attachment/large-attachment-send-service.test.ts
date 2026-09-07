import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendPreparedLargeAttachmentRecipientContent,
  isLargeAttachmentSendEnabled,
  resolveLargeAttachmentPublicBaseUrl,
} from "./large-attachment-send-service";
import { assertNoLargeAttachmentProviderPayload } from "../transport/mail-transport-adapter";

const cards = [
  {
    attachmentId: "large-1",
    filename: "IMG_5940.mov",
    sizeBytes: 17_581_697,
    downloadUrl: "https://files.test/f/opaque-token",
    recipientExpiresAt: "2026-09-14T00:00:00.000Z",
  },
];

describe("large attachment link delivery contract", () => {
  it("defaults SEND_ENABLED to false and requires explicit opt-in", () => {
    assert.equal(isLargeAttachmentSendEnabled({}), false);
    assert.equal(
      isLargeAttachmentSendEnabled({
        MAIL_LARGE_ATTACHMENT_SEND_ENABLED: "true",
      }),
      true,
    );
    assert.equal(
      isLargeAttachmentSendEnabled({
        MAIL_LARGE_ATTACHMENT_SEND_ENABLED: "1",
      }),
      true,
    );
  });

  it("validates configurable Gateway base URLs", () => {
    assert.equal(
      resolveLargeAttachmentPublicBaseUrl({
        MAIL_LARGE_ATTACHMENT_PUBLIC_BASE_URL: "https://files.test/",
      }),
      "https://files.test",
    );
    assert.equal(
      resolveLargeAttachmentPublicBaseUrl({
        MAIL_LARGE_ATTACHMENT_PUBLIC_BASE_URL: "javascript:alert(1)",
      }),
      null,
    );
    assert.equal(
      resolveLargeAttachmentPublicBaseUrl({
        MAIL_LARGE_ATTACHMENT_PUBLIC_BASE_URL: "https://files.test/?raw=1",
      }),
      null,
    );
  });

  it("renders HTML and text cards without mutating authored body input", () => {
    const authored = {
      bodyText: "Original body",
      bodyHtml: "<p>Original body</p>",
    };
    const rendered = appendPreparedLargeAttachmentRecipientContent({
      ...authored,
      cards,
    });

    assert.equal(authored.bodyText, "Original body");
    assert.equal(authored.bodyHtml, "<p>Original body</p>");
    assert.match(rendered.bodyText ?? "", /https:\/\/files\.test\/f\/opaque-token/);
    assert.match(rendered.bodyText ?? "", /not been automatically scanned/i);
    assert.match(rendered.bodyHtml ?? "", /下载附件/);
    assert.match(rendered.bodyHtml ?? "", /IMG_5940\.mov/);
    assert.match(rendered.bodyHtml ?? "", /7 days after successful delivery/);
  });

  it("hard-fails if a large attachment reaches provider mapping", () => {
    assert.throws(
      () =>
        assertNoLargeAttachmentProviderPayload({
          attachments: [
            {
              revisionAttachmentId: "large-1",
              storedFileId: "stored-1",
              contentHash: "a".repeat(64),
              displayFilename: "IMG_5940.mov",
              mimeType: "video/quicktime",
              sizeBytes: 17_581_697,
              sortOrder: 0,
              deliveryMode: "large_attachment",
              secureExpiryDays: null,
            },
          ],
        }),
      /recipient links/,
    );
  });
});
