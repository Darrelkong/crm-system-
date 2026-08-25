import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailReadApiError } from "@/lib/mail/client/mail-read-api-errors";
import {
  buildProductionAttachmentDownloadHref,
  buildProductionAttachmentRowPresentation,
} from "@/lib/mail/client/mail-attachment-download-ui";
import type { MailDetailAttachmentPresentation } from "@/lib/mail/client/mail-workspace-ui-adapters";

function attachmentFixture(
  overrides: Partial<MailDetailAttachmentPresentation> = {},
): MailDetailAttachmentPresentation {
  return {
    id: "attachment-1",
    filename: "invoice.pdf",
    mimeType: "application/pdf",
    sizeLabel: "2.0 KB",
    deliveryMode: "direct_attachment",
    downloadAvailable: true,
    ...overrides,
  };
}

describe("mail attachment download UI helpers", () => {
  it("builds same-origin download href with encoded attachment id and folder", () => {
    assert.equal(
      buildProductionAttachmentDownloadHref(
        "LOCAL_MAIL_ATTACHMENT_VERIFY_2H5B-ATT-CLEAN-PDF",
        "inbox",
      ),
      "/api/mail/attachments/LOCAL_MAIL_ATTACHMENT_VERIFY_2H5B-ATT-CLEAN-PDF/download?folder=inbox",
    );
    assert.equal(
      buildProductionAttachmentDownloadHref("attachment/id", "trash"),
      "/api/mail/attachments/attachment%2Fid/download?folder=trash",
    );
  });

  it("rejects invalid folder values", () => {
    assert.throws(
      () => buildProductionAttachmentDownloadHref("attachment-1", "drafts" as "inbox"),
      MailReadApiError,
    );
  });

  it("returns interactive href only when downloadAvailable is true", () => {
    const available = buildProductionAttachmentRowPresentation({
      attachment: attachmentFixture(),
      folder: "sent",
    });
    assert.equal(available.downloadAvailable, true);
    assert.equal(
      available.downloadHref,
      "/api/mail/attachments/attachment-1/download?folder=sent",
    );

    const unavailable = buildProductionAttachmentRowPresentation({
      attachment: attachmentFixture({ downloadAvailable: false }),
      folder: "inbox",
    });
    assert.equal(unavailable.downloadHref, null);
  });

  it("does not include storage identifiers in href", () => {
    const row = buildProductionAttachmentRowPresentation({
      attachment: attachmentFixture({ id: "opaque-id" }),
      folder: "inbox",
    });
    assert.match(row.downloadHref ?? "", /^\/api\/mail\/attachments\//);
    assert.equal(row.downloadHref?.includes("storageKey"), false);
    assert.equal(row.downloadHref?.includes("storedFileId"), false);
  });

  it("uses trash folder context in href", () => {
    const row = buildProductionAttachmentRowPresentation({
      attachment: attachmentFixture(),
      folder: "trash",
    });
    assert.match(row.downloadHref ?? "", /folder=trash$/);
  });

  it("marks secure_file rows as non-downloadable even if boolean were true", () => {
    const row = buildProductionAttachmentRowPresentation({
      attachment: attachmentFixture({
        deliveryMode: "secure_file",
        downloadAvailable: false,
      }),
      folder: "inbox",
    });
    assert.equal(row.showSecureFileLabel, true);
    assert.equal(row.downloadAvailable, false);
    assert.equal(row.downloadHref, null);
  });
});
