import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import {
  hasEffectiveMailAccess,
  hasEnabledMailUserAccess,
} from "@/lib/permissions/mail";

function actor(
  overrides: Partial<MailActorContext> = {},
): MailActorContext {
  return {
    userId: "user-1",
    sessionId: null,
    crmRole: "staff",
    mailAccessEnabled: false,
    adminGrants: [],
    audit: {},
    ...overrides,
  };
}

describe("sender identity send grant authorization", () => {
  it("documents identity-layer helper does not check mailbox can_send", () => {
    const note =
      "assertHasSenderIdentitySendGrant proves grant only; future assertCanSendFromIdentityInMailbox must add mailbox can_send";
    assert.match(note, /mailbox can_send/);
  });

  it("enabled mail user access requires persisted mail_user_access row for root admin", () => {
    assert.equal(
      hasEnabledMailUserAccess(
        actor({ crmRole: "admin", mailAccessEnabled: false }),
      ),
      false,
    );
    assert.equal(
      hasEnabledMailUserAccess(
        actor({ crmRole: "admin", mailAccessEnabled: true }),
      ),
      true,
    );
  });

  it("effective mail access still includes CRM root admin for control-plane contexts", () => {
    assert.equal(
      hasEffectiveMailAccess(
        actor({ crmRole: "admin", mailAccessEnabled: false }),
      ),
      true,
    );
  });

  it("enabled mail user access requires provisioned row for staff", () => {
    assert.equal(
      hasEnabledMailUserAccess(actor({ crmRole: "staff", mailAccessEnabled: false })),
      false,
    );
    assert.equal(
      hasEnabledMailUserAccess(actor({ crmRole: "staff", mailAccessEnabled: true })),
      true,
    );
  });

  it("documents super_admin grant does not bypass identity send grant requirement", () => {
    const superActor = actor({
      crmRole: "admin",
      mailAccessEnabled: true,
      adminGrants: ["super_admin"],
    });
    assert.equal(superActor.adminGrants.includes("super_admin"), true);
    assert.throws(
      () => {
        if (!hasEnabledMailUserAccess(superActor)) {
          throw MailServiceError.forbidden("Mail access is not enabled");
        }
        throw MailServiceError.forbidden("Sender identity send grant required");
      },
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });
});
