import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailDraft } from "../../../drizzle/schema/mail-drafts";
import { toSafeDraftView } from "@/lib/mail/draft-serialization";
import { hasMeaningfulDraftContent } from "@/lib/mail/draft-service";

function draftRow(overrides: Partial<MailDraft> = {}): MailDraft {
  return {
    id: "draft-1",
    authorUserId: "user-1",
    mailboxId: "mailbox-1",
    senderIdentityId: "identity-1",
    subject: "",
    bodyText: "",
    bodyHtml: null,
    sensitivity: "normal",
    composeMode: "new",
    replyToMessageId: null,
    autosaveVersion: 0,
    lastSavedAt: "2026-01-01T00:00:00.000Z",
    discardedAt: null,
    customerId: null,
    customerAssociationType: null,
    customerAssociatedByUserId: null,
    customerAssociatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("draft serialization security", () => {
  it("strips executable markup from legacy stored draft HTML on read", () => {
    const unsafe =
      '<script>alert(1)</script><div onclick="evil()">Hello</div><a href="javascript:evil()">click</a>';
    const view = toSafeDraftView(
      draftRow({ bodyHtml: unsafe, bodyText: "Hello" }),
    );

    assert.doesNotMatch(view.bodyHtml ?? "", /<script/i);
    assert.doesNotMatch(view.bodyHtml ?? "", /onclick/i);
    assert.doesNotMatch(view.bodyHtml ?? "", /javascript:/i);
    assert.match(view.bodyHtml ?? "", /Hello/);
  });
});

describe("hasMeaningfulDraftContent", () => {
  it("ignores sender/mailbox defaults alone", () => {
    assert.equal(hasMeaningfulDraftContent({}), false);
  });

  it("treats sanitized-only html as meaningful when non-empty", () => {
    assert.equal(
      hasMeaningfulDraftContent({ bodyHtml: "<p>Hello</p>" }),
      true,
    );
  });
});
