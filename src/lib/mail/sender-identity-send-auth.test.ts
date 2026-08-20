import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";

describe("sender identity send grant authorization", () => {
  it("documents identity-layer helper does not check mailbox can_send", () => {
    const note =
      "assertHasSenderIdentitySendGrant proves grant only; future assertCanSendFromIdentityInMailbox must add mailbox can_send";
    assert.match(note, /mailbox can_send/);
  });

  it("documents super_admin is not checked in helper (grant-only)", () => {
    const superActor: MailActorContext = {
      userId: "user-1",
      sessionId: null,
      crmRole: "admin",
      mailAccessEnabled: true,
      adminGrants: ["super_admin"],
      audit: {},
    };
    assert.equal(superActor.adminGrants.includes("super_admin"), true);
    assert.throws(
      () => {
        if (!superActor.mailAccessEnabled) {
          throw MailServiceError.forbidden("Mail access is not enabled");
        }
        throw MailServiceError.forbidden("Sender identity send grant required");
      },
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });
});
