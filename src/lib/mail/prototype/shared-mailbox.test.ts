import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyStatusTransition,
  canMentionUser,
  getSharedAuthorizedMembers,
  isUnreadForActor,
  matchesSharedViewFilter,
  resolveSharedPermission,
  shouldShowSharedCustomerBadge,
  shouldWarnSharedReply,
} from "./shared-mailbox";
import type { MailMessage } from "./types";

const sharedMsg = (over: Partial<MailMessage>): MailMessage => ({
  id: "s1",
  folder: "inbox",
  mailbox: "hello@echfronthk.com",
  fromName: "X",
  fromEmail: "x@test.com",
  to: ["hello@echfronthk.com"],
  subject: "Test",
  preview: "",
  body: "",
  sentAt: "2026-08-18T10:00:00+08:00",
  isUnread: true,
  hasAttachment: false,
  attachments: [],
  customerMatch: null,
  assignment: "unassigned",
  processingStatus: "unclaimed",
  assigneeId: null,
  readByUserIds: [],
  ...over,
});

describe("shared-mailbox", () => {
  it("unclaimed status clears assignee", () => {
    const r = applyStatusTransition("unclaimed", "staff-a");
    assert.equal(r.processingStatus, "unclaimed");
    assert.equal(r.assigneeId, null);
  });

  it("in_progress requires assignee", () => {
    assert.throws(() => applyStatusTransition("in_progress", null));
  });

  it("personal read is per user on shared messages", () => {
    const msg = sharedMsg({ readByUserIds: ["staff-a"] });
    assert.equal(isUnreadForActor(msg, "staff-a"), false);
    assert.equal(isUnreadForActor(msg, "staff-b"), true);
  });

  it("shared view filter mine", () => {
    const msg = sharedMsg({
      processingStatus: "in_progress",
      assigneeId: "staff-a",
    });
    assert.equal(matchesSharedViewFilter(msg, "mine", "staff-a"), true);
    assert.equal(matchesSharedViewFilter(msg, "mine", "staff-b"), false);
  });

  it("reply warning when assigned to other", () => {
    const msg = sharedMsg({
      processingStatus: "in_progress",
      assigneeId: "staff-b",
    });
    assert.equal(shouldWarnSharedReply(msg, "staff-a"), true);
    assert.equal(shouldWarnSharedReply(msg, "staff-b"), false);
  });

  it("read_only permission blocks reply", () => {
    const perm = resolveSharedPermission("staff-a", "read_only");
    assert.equal(perm.canRead, true);
    assert.equal(perm.canReply, false);
  });

  it("mention only authorized shared members", () => {
    assert.equal(canMentionUser("staff-a"), true);
    assert.equal(getSharedAuthorizedMembers().includes("admin"), true);
  });

  it("shared mailbox does not elevate CRM customer visibility", () => {
    const robertMsg = sharedMsg({
      id: "msg-5",
      fromEmail: "robert@example.com",
      customerMatch: { id: "cust-robert", name: "Robert Lee" },
      processingStatus: "in_progress",
      assigneeId: "staff-b",
    });
    assert.equal(shouldShowSharedCustomerBadge(robertMsg, "shared_mailbox"), false);
    assert.equal(shouldShowSharedCustomerBadge(robertMsg, "staff_b"), true);
    assert.equal(shouldShowSharedCustomerBadge(robertMsg, "admin"), true);
  });
});
