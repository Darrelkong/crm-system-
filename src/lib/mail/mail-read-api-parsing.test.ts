import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailServiceError } from "@/lib/mail/errors";
import {
  parseRequiredAttachmentId,
  parseRequiredMessageId,
  parseRequiredResourceId,
  parseRequiredThreadId,
} from "@/lib/mail/mail-read-api-parsing";

describe("mail read resource id parsing", () => {
  it("accepts canonical fixture-style message ids", () => {
    assert.equal(
      parseRequiredMessageId("mail-read-api-detail-msg"),
      "mail-read-api-detail-msg",
    );
  });

  it("accepts uuid message ids", () => {
    const id = "00000000-0000-0000-0000-000000000099";
    assert.equal(parseRequiredMessageId(id), id);
  });

  it("rejects non-string resource ids with validation errors", () => {
    assert.throws(
      () => parseRequiredMessageId({ id: "x" }),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 400);
        assert.match(error.message, /must be a string/);
        return true;
      },
    );
  });

  it("rejects empty message ids", () => {
    assert.throws(
      () => parseRequiredMessageId("   "),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 400);
        return true;
      },
    );
  });

  it("rejects overlong resource ids", () => {
    assert.throws(
      () => parseRequiredResourceId("x".repeat(192), "messageId"),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 400);
        assert.match(error.message, /invalid/);
        return true;
      },
    );
  });

  it("parses thread ids with the same contract", () => {
    assert.equal(parseRequiredThreadId("thread-1"), "thread-1");
  });

  it("parses attachment ids with the same contract", () => {
    assert.equal(
      parseRequiredAttachmentId("LOCAL_MAIL_ATTACHMENT_VERIFY_2H5B-ATT-CLEAN-PDF"),
      "LOCAL_MAIL_ATTACHMENT_VERIFY_2H5B-ATT-CLEAN-PDF",
    );
  });
});
