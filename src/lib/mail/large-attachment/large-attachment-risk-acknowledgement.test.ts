import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidLargeAttachmentAcknowledgement,
  LARGE_ATTACHMENT_NOTICE_VERSION,
  LARGE_ATTACHMENT_RISK_ACKNOWLEDGEMENT_TEXT,
} from "./large-attachment-risk-acknowledgement";

test("requires the exact V1 notice version and explicit confirmation", () => {
  assert.equal(
    isValidLargeAttachmentAcknowledgement({
      acknowledged: true,
      noticeVersion: LARGE_ATTACHMENT_NOTICE_VERSION,
    }),
    true,
  );
  assert.equal(
    isValidLargeAttachmentAcknowledgement({
      acknowledged: false,
      noticeVersion: LARGE_ATTACHMENT_NOTICE_VERSION,
    }),
    false,
  );
  assert.equal(
    isValidLargeAttachmentAcknowledgement({
      acknowledged: true,
      noticeVersion: "large_attachment_notice_old",
    }),
    false,
  );
});

test("keeps the canonical no-scan declaration text", () => {
  assert.match(LARGE_ATTACHMENT_RISK_ACKNOWLEDGEMENT_TEXT, /暂未对大附件进行自动安全扫描/);
  assert.match(LARGE_ATTACHMENT_RISK_ACKNOWLEDGEMENT_TEXT, /请勿上传含有病毒、木马/);
  assert.match(LARGE_ATTACHMENT_RISK_ACKNOWLEDGEMENT_TEXT, /上传人应对其上传文件/);
});
