import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import { translate } from "@/i18n/translate";
import {
  MAIL_COMPOSE_ATTACHMENT_LIMITS,
  composeAttachmentLimitI18nParams,
} from "@/lib/mail/compose-attachment-policy";
import {
  buildAttachmentPolicyMessageKey,
  composeAttachmentPolicyErrorParams,
  composeAttachmentUploadErrorMessageKey,
} from "@/lib/mail/client/compose-attachment-upload";
import {
  composeAttachmentTrayListClassName,
} from "@/lib/mail/client/compose-attachment-tray";
import {
  resolveComposeOutboundWorkflow,
  resolveComposeSubmitButtonLabelKey,
  resolveComposeSubmittingLabelKey,
  resolveComposeSubmissionErrorMessage,
} from "@/lib/mail/client/compose-submission";

const localeSources = [
  { locale: "en", messages: en },
  { locale: "zh-Hans", messages: zhHans },
  { locale: "zh-Hant", messages: zhHant },
] as const;

const attachmentParams = composeAttachmentLimitI18nParams();

describe("compose CTA i18n", () => {
  it("routes authorized root admin workflow to admin_direct", () => {
    assert.equal(resolveComposeOutboundWorkflow(true), "admin_direct");
    assert.equal(resolveComposeOutboundWorkflow(false), "staff_approved");
  });

  for (const { locale, messages } of localeSources) {
    it(`resolves root admin CTA for ${locale}`, () => {
      const key = resolveComposeSubmitButtonLabelKey({
        submitting: false,
        workflow: "admin_direct",
        approvalReturned: false,
      });
      const label = translate(messages, key);
      if (locale === "zh-Hant") {
        assert.equal(label, "發送郵件");
      } else if (locale === "zh-Hans") {
        assert.equal(label, "发送邮件");
      } else {
        assert.equal(label, "Send");
      }
    });

    it(`resolves staff CTA for ${locale}`, () => {
      const key = resolveComposeSubmitButtonLabelKey({
        submitting: false,
        workflow: "staff_approved",
        approvalReturned: false,
      });
      const label = translate(messages, key);
      if (locale === "zh-Hant") {
        assert.equal(label, "提交審核");
      } else if (locale === "zh-Hans") {
        assert.equal(label, "提交审核");
      } else {
        assert.equal(label, "Submit for approval");
      }
    });
  }
});

describe("compose attachment i18n", () => {
  for (const { locale, messages } of localeSources) {
    it(`localizes single-file-too-large for ${locale}`, () => {
      const key = composeAttachmentUploadErrorMessageKey("FILE_TOO_LARGE");
      const params = composeAttachmentPolicyErrorParams("FILE_TOO_LARGE");
      const label = translate(messages, key, params);
      assert.doesNotMatch(label, /Attachment exceeds maximum single-file size/i);
      assert.match(label, /3 MB/);
      if (locale === "zh-Hant") {
        assert.match(label, /單一附件不可超過/);
      } else if (locale === "zh-Hans") {
        assert.match(label, /单个附件不可超过/);
      } else {
        assert.match(label, /Each attachment must be/);
      }
    });

    it(`localizes total-size and count errors for ${locale}`, () => {
      const totalKey = buildAttachmentPolicyMessageKey("TOTAL_SIZE_EXCEEDED");
      const countKey = buildAttachmentPolicyMessageKey("TOO_MANY_ATTACHMENTS");
      const total = translate(
        messages,
        totalKey,
        composeAttachmentPolicyErrorParams("TOTAL_SIZE_EXCEEDED"),
      );
      const count = translate(
        messages,
        countKey,
        composeAttachmentPolicyErrorParams("TOO_MANY_ATTACHMENTS"),
      );
      assert.doesNotMatch(total, /Total attachment size would exceed the limit/i);
      assert.doesNotMatch(count, /Maximum attachment count reached/i);
      assert.match(total, /3 MB/);
      assert.match(count, /10/);
    });
  }

  it("does not render raw English policy message in Chinese UI", () => {
    const key = buildAttachmentPolicyMessageKey("FILE_TOO_LARGE");
    const zhLabel = translate(
      zhHant,
      key,
      composeAttachmentPolicyErrorParams("FILE_TOO_LARGE"),
    );
    assert.doesNotMatch(zhLabel, /Attachment exceeds maximum single-file size/);
    assert.equal(
      resolveComposeSubmissionErrorMessage(
        key,
        (messageKey, params) => translate(zhHant, messageKey, params),
        composeAttachmentPolicyErrorParams("FILE_TOO_LARGE"),
      ),
      zhLabel,
    );
  });

  it("documents unchanged single-file limit for admin and staff", () => {
    assert.equal(
      MAIL_COMPOSE_ATTACHMENT_LIMITS.maxSingleFileBytes,
      3 * 1024 * 1024,
    );
    assert.equal(attachmentParams.size, "3 MB");
  });
});

describe("compose mobile layout guards", () => {
  it("keeps mobile bottom dock spacing and wrapped attachment errors", () => {
    const editor = readFileSync(
      "src/components/mail/compose/mail-compose-editor.tsx",
      "utf8",
    );
    const attachmentList = readFileSync(
      "src/components/mail/compose/mail-compose-attachment-list.tsx",
      "utf8",
    );
    const css = readFileSync("src/app/globals.css", "utf8");
    assert.match(editor, /mail-compose-bottom-dock[\s\S]*pb-5/);
    assert.match(attachmentList, /break-words/);
    assert.match(
      composeAttachmentTrayListClassName("embedded-mobile"),
      /mail-compose-attachment-tray-list--mobile/,
    );
    assert.match(css, /mail-compose-attachment-tray-list--mobile/);
    assert.match(
      readFileSync(
        "src/components/mail/compose/mail-compose-submission-status.tsx",
        "utf8",
      ),
      /break-words/,
    );
  });
});
