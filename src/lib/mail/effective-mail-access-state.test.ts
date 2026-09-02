import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveEffectiveStateFromSnapshot,
  type MailEffectiveAccessState,
} from "@/lib/mail/effective-mail-access-state";

function state(input: {
  mailboxState?: "none" | "active" | "archived";
  mailAccessEnabled?: boolean;
  notificationIdentityState?:
    | "missing"
    | "pending"
    | "verified"
    | "replacement_pending"
    | "security_revoked";
}): MailEffectiveAccessState {
  return resolveEffectiveStateFromSnapshot({
    userRole: "staff",
    mailboxState: input.mailboxState,
    mailAccessEnabled: input.mailAccessEnabled ?? false,
    notificationIdentityState: input.notificationIdentityState,
  }).effectiveState;
}

describe("effective staff Mail access state", () => {
  it("resolves all canonical staff states", () => {
    assert.equal(state({}), "NO_MAILBOX");
    assert.equal(
      state({ mailboxState: "active", mailAccessEnabled: true }),
      "MAILBOX_ASSIGNED_NOTIFICATION_MISSING",
    );
    assert.equal(
      state({
        mailboxState: "active",
        mailAccessEnabled: true,
        notificationIdentityState: "pending",
      }),
      "MAILBOX_ASSIGNED_NOTIFICATION_PENDING",
    );
    assert.equal(
      state({
        mailboxState: "active",
        mailAccessEnabled: true,
        notificationIdentityState: "verified",
      }),
      "READY",
    );
    assert.equal(
      state({ mailboxState: "active", mailAccessEnabled: false }),
      "ADMIN_DISABLED",
    );
    assert.equal(
      state({
        mailboxState: "active",
        mailAccessEnabled: false,
        notificationIdentityState: "security_revoked",
      }),
      "IDENTITY_SECURITY_REVOKED",
    );
    assert.equal(
      state({ mailboxState: "archived", mailAccessEnabled: true }),
      "MAILBOX_ARCHIVED",
    );
  });

  it("keeps a verified identity effective during replacement_pending", () => {
    const resolved = resolveEffectiveStateFromSnapshot({
      userRole: "staff",
      mailboxState: "active",
      mailAccessEnabled: true,
      notificationIdentityState: "replacement_pending",
    });
    assert.equal(resolved.effectiveState, "READY");
    assert.equal(resolved.canUseMailbox, true);
  });

  it("keeps Admin management independent from personal prerequisites", () => {
    const resolved = resolveEffectiveStateFromSnapshot({
      userRole: "admin",
      mailboxState: "none",
      mailAccessEnabled: false,
      notificationIdentityState: "missing",
    });
    assert.equal(resolved.canUseMailAdmin, true);
    assert.equal(resolved.canUseMailbox, true);
  });
});
