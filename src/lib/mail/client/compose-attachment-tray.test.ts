import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import { translate } from "@/i18n/translate";
import { MAIL_COMPOSE_ATTACHMENT_LIMITS } from "@/lib/mail/compose-attachment-policy";
import {
  composeAttachmentTrayKindKey,
  composeAttachmentTrayListClassName,
  composeAttachmentTrayRootClassName,
  composeAttachmentTraySummaryKey,
  summarizeComposeAttachments,
} from "@/lib/mail/client/compose-attachment-tray";
import {
  resolveComposeSubmitButtonLabelKey,
} from "@/lib/mail/client/compose-submission";
import { buildAttachmentPolicyMessageKey } from "@/lib/mail/client/compose-attachment-upload";

describe("compose attachment tray", () => {
  it("summarizes attachment count and aggregate size", () => {
    const summary = summarizeComposeAttachments([
      { sizeBytes: 1024 },
      { sizeBytes: 2048 },
    ]);
    assert.equal(summary.count, 2);
    assert.equal(summary.totalBytes, 3072);
    assert.equal(summary.totalSizeLabel, "3.0 KB");
  });

  it("uses bounded tray classes without collapse controls", () => {
    const tray = readFileSync(
      "src/lib/mail/client/compose-attachment-tray.ts",
      "utf8",
    );
    const list = readFileSync(
      "src/components/mail/compose/mail-compose-attachment-list.tsx",
      "utf8",
    );
    assert.match(tray, /mail-compose-attachment-tray-list--desktop/);
    assert.match(tray, /mail-compose-attachment-tray-list--mobile/);
    assert.match(list, /truncate/);
    assert.match(list, /min-w-0/);
    assert.doesNotMatch(list, /展開|收起|collapse|expand/i);
  });

  it("uses two-column desktop grid and one-column mobile grid", () => {
    assert.match(
      composeAttachmentTrayListClassName("floating-desktop"),
      /sm:grid-cols-2/,
    );
    assert.match(
      composeAttachmentTrayListClassName("embedded-mobile"),
      /grid-cols-1/,
    );
    assert.doesNotMatch(
      composeAttachmentTrayListClassName("embedded-mobile"),
      /grid-cols-2/,
    );
  });

  it("places attachment tray before body stack in composer layout", () => {
    const editor = readFileSync(
      "src/components/mail/compose/mail-compose-editor.tsx",
      "utf8",
    );
    const trayIndex = editor.indexOf("<MailComposeAttachmentList");
    const bodyStackIndex = editor.indexOf("mail-compose-body-stack--with-attachments");
    const footerIndex = editor.indexOf("mail-compose-footer");
    assert.ok(trayIndex > 0);
    assert.ok(bodyStackIndex > trayIndex);
    assert.ok(footerIndex > bodyStackIndex);
    assert.equal(
      (editor.match(/<MailComposeAttachmentList/g) ?? []).length,
      1,
    );
  });

  it("protects body, toolbar, and footer regions in CSS", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    assert.match(css, /mail-compose-attachment-tray-list--desktop[\s\S]*max-height: min\(180px, 28dvh\)/);
    assert.match(css, /mail-compose-attachment-tray-list--mobile[\s\S]*max-height: min\(140px, 22dvh\)/);
    assert.match(css, /mail-compose-body-stack--with-attachments/);
    assert.match(css, /mail-compose-bottom-dock/);
  });

  it("keeps duplicate filenames as independent attachment rows", () => {
    const summary = summarizeComposeAttachments([
      { sizeBytes: 100 },
      { sizeBytes: 200 },
    ]);
    assert.equal(summary.count, 2);
  });

  it("leaves direct attachment policy unchanged", () => {
    assert.equal(
      MAIL_COMPOSE_ATTACHMENT_LIMITS.maxSingleFileBytes,
      3 * 1024 * 1024,
    );
    assert.equal(MAIL_COMPOSE_ATTACHMENT_LIMITS.maxAttachmentCount, 10);
  });

  it("keeps workflow CTA label keys intact", () => {
    assert.equal(
      resolveComposeSubmitButtonLabelKey({
        submitting: false,
        workflow: "admin_direct",
        approvalReturned: false,
      }),
      "mail.compose.send",
    );
    assert.equal(
      resolveComposeSubmitButtonLabelKey({
        submitting: false,
        workflow: "staff_approved",
        approvalReturned: false,
      }),
      "mail.compose.submitApproval",
    );
  });

  it("localizes tray summary for Chinese locales", () => {
    const params = { count: "8", totalSize: "2.6 MB" };
    const zhHantLabel = translate(
      zhHant,
      composeAttachmentTraySummaryKey(),
      params,
    );
    const zhHansLabel = translate(
      zhHans,
      composeAttachmentTraySummaryKey(),
      params,
    );
    assert.match(zhHantLabel, /附件 8 個 · 2\.6 MB/);
    assert.match(zhHansLabel, /附件 8 个 · 2\.6 MB/);
    assert.match(
      translate(zhHant, composeAttachmentTrayKindKey([{ kind: "attachment" }])),
      /普通附件/,
    );
  });

  it("does not leak raw English attachment policy strings in zh-Hant", () => {
    const key = buildAttachmentPolicyMessageKey("FILE_TOO_LARGE");
    const label = translate(
      zhHant,
      key,
      { size: "3 MB" },
    );
    assert.doesNotMatch(label, /Attachment exceeds maximum single-file size/);
  });

  it("uses shrink-0 tray root so attachments do not consume flex growth", () => {
    assert.match(
      composeAttachmentTrayRootClassName("floating-desktop"),
      /shrink-0/,
    );
    assert.match(
      composeAttachmentTrayRootClassName("embedded-mobile"),
      /shrink-0/,
    );
  });

  it("reserves large-attachment tray architecture without implementing R2", () => {
    const trayModule = readFileSync(
      "src/lib/mail/client/compose-attachment-tray.ts",
      "utf8",
    );
    assert.doesNotMatch(trayModule, /r2|presigned|files\.echfronthk\.com/i);
    assert.match(trayModule, /kindDirect/);
  });
});
