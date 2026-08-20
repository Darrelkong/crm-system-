import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReplyAllDraft,
  hasReplyAllTargets,
  shouldShowReplyAllWarning,
} from "./message-actions";
import type { MailMessage } from "./types";

const base: MailMessage = {
  id: "m1",
  folder: "inbox",
  mailbox: "hello@echfronthk.com",
  fromName: "John",
  fromEmail: "john@gmail.com",
  to: ["hello@echfronthk.com"],
  cc: ["mary@example.com"],
  subject: "Test",
  preview: "",
  body: "Body",
  sentAt: "2026-08-18T10:00:00+08:00",
  isUnread: false,
  hasAttachment: false,
  attachments: [],
  customerMatch: null,
  assignment: "none",
};

describe("message-actions", () => {
  it("reply all excludes own mailbox from recipients", () => {
    const draft = buildReplyAllDraft(base);
    assert.deepEqual(draft.to, ["john@gmail.com"]);
    assert.deepEqual(draft.cc, ["mary@example.com"]);
    assert.ok(!draft.to.includes("hello@echfronthk.com"));
    assert.ok(!draft.cc.includes("hello@echfronthk.com"));
  });

  it("hasReplyAllTargets when cc present", () => {
    assert.equal(hasReplyAllTargets(base), true);
  });

  it("warns on mixed internal and external recipients", () => {
    assert.equal(
      shouldShowReplyAllWarning(
        ["john@gmail.com"],
        ["a@echfronthk.com"],
      ),
      true,
    );
  });
});
