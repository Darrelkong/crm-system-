import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertMailAccessEnabled,
  assertEffectiveMailAccess,
  hasEnabledMailUserAccess,
  assertMailAccountManagement,
  assertMailAddressAssignment,
  assertMailAdminRead,
  assertMailPermissionManagement,
  assertMailSenderIdentityGrantManagement,
  assertMailSenderIdentityManagement,
  assertMailSignatureTemplateManagement,
  hasAnyMailAdminGrant,
  hasMailAdminGrant,
  assertMailOutboundApprovalReview,
  assertMailDeliveryHealth,
  assertMailInboundFallbackConfigManagement,
  assertNotificationIdentitySecurityManagement,
  assertNotificationIdentityTargetAccess,
  hasMailDeliveryHealth,
  isEligiblePersonalMailboxOwner,
} from "@/lib/permissions/mail";

function actor(
  overrides: Partial<MailActorContext> = {},
): MailActorContext {
  return {
    userId: "user-1",
    sessionId: null,
    crmRole: "staff",
    mailAccessEnabled: true,
    adminGrants: [],
    audit: {},
    ...overrides,
  };
}

describe("mail permissions", () => {
  it("grants effective mail access to CRM root admin without provisioned access", () => {
    assert.doesNotThrow(() =>
      assertEffectiveMailAccess(
        actor({ crmRole: "admin", mailAccessEnabled: false }),
      ),
    );
  });

  it("denies actor without effective mail access", () => {
    assert.throws(
      () =>
        assertEffectiveMailAccess(
          actor({ crmRole: "staff", mailAccessEnabled: false }),
        ),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "FORBIDDEN",
    );
  });

  it("denies actor without persisted mail access via assertMailAccessEnabled", () => {
    assert.throws(
      () => assertMailAccessEnabled(actor({ mailAccessEnabled: false })),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "FORBIDDEN",
    );
    assert.throws(
      () =>
        assertMailAccessEnabled(
          actor({ crmRole: "admin", mailAccessEnabled: false }),
        ),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "FORBIDDEN",
    );
  });

  it("separates enabled mail user access from effective mail access for root admin", () => {
    const rootWithoutRow = actor({ crmRole: "admin", mailAccessEnabled: false });
    assert.equal(hasEnabledMailUserAccess(rootWithoutRow), false);
    assert.doesNotThrow(() => assertEffectiveMailAccess(rootWithoutRow));
    assert.doesNotThrow(() => assertMailAccountManagement(rootWithoutRow));
  });

  it("allows CRM root admin for management grants without explicit mail admin grant", () => {
    assert.doesNotThrow(() => assertMailAccountManagement(actor({ crmRole: "admin" })));
    assert.doesNotThrow(() => assertMailAddressAssignment(actor({ crmRole: "admin" })));
  });

  it("denies staff without required mail admin grant", () => {
    assert.throws(
      () => assertMailAccountManagement(actor({ crmRole: "staff" })),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "FORBIDDEN",
    );
    assert.throws(
      () => assertMailAddressAssignment(actor({ crmRole: "staff" })),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "FORBIDDEN",
    );
  });

  it("allows account management with account_mgmt grant", () => {
    assert.doesNotThrow(() =>
      assertMailAccountManagement(
        actor({ adminGrants: ["account_mgmt"] }),
      ),
    );
  });

  it("allows address assignment with address_assignment grant", () => {
    assert.doesNotThrow(() =>
      assertMailAddressAssignment(
        actor({ adminGrants: ["address_assignment"] }),
      ),
    );
  });

  it("allows super_admin for both management grants", () => {
    const superActor = actor({ adminGrants: ["super_admin"] });
    assert.doesNotThrow(() => assertMailAccountManagement(superActor));
    assert.doesNotThrow(() => assertMailAddressAssignment(superActor));
    assert.doesNotThrow(() => assertMailAdminRead(superActor));
  });

  it("does not treat global_mail_read as management authority", () => {
    const readActor = actor({ adminGrants: ["global_mail_read"] });
    assert.equal(hasMailAdminGrant(readActor, "global_mail_read"), true);
    assert.equal(
      hasAnyMailAdminGrant(readActor, ["account_mgmt", "super_admin"]),
      false,
    );
    assert.throws(() => assertMailAccountManagement(readActor));
    assert.throws(() => assertMailAddressAssignment(readActor));
    assert.throws(() => assertMailAdminRead(readActor));
  });

  it("keeps account management and address assignment separate for mutations", () => {
    const accountActor = actor({ adminGrants: ["account_mgmt"] });
    assert.doesNotThrow(() => assertMailAccountManagement(accountActor));
    assert.throws(() => assertMailAddressAssignment(accountActor));
  });

  it("allows address_assignment to read mailbox metadata", () => {
    const addressActor = actor({ adminGrants: ["address_assignment"] });
    assert.doesNotThrow(() => assertMailAdminRead(addressActor));
    assert.throws(() => assertMailAccountManagement(addressActor));
  });

  it("allows permission management with permission_mgmt grant", () => {
    assert.doesNotThrow(() =>
      assertMailPermissionManagement(
        actor({ adminGrants: ["permission_mgmt"] }),
      ),
    );
  });

  it("documents super_admin does not imply sender identity send (no grant helper)", () => {
    const superActor = actor({ adminGrants: ["super_admin"] });
    assert.equal(hasMailAdminGrant(superActor, "super_admin"), true);
    // Sender identity grants are a separate frozen model; no helper implies send.
    assert.equal(
      hasAnyMailAdminGrant(superActor, ["global_mail_read"]),
      false,
    );
  });

  it("allows address_assignment for sender identity management", () => {
    assert.doesNotThrow(() =>
      assertMailSenderIdentityManagement(
        actor({ adminGrants: ["address_assignment"] }),
      ),
    );
  });

  it("denies global_mail_read for sender identity management", () => {
    assert.throws(() =>
      assertMailSenderIdentityManagement(
        actor({ adminGrants: ["global_mail_read"] }),
      ),
    );
  });

  it("allows signature_template for signature management", () => {
    assert.doesNotThrow(() =>
      assertMailSignatureTemplateManagement(
        actor({ adminGrants: ["signature_template"] }),
      ),
    );
  });

  it("denies sender identity send grant for signature management", () => {
    assert.throws(() =>
      assertMailSignatureTemplateManagement(
        actor({ adminGrants: ["address_assignment"] }),
      ),
    );
  });

  it("uses address_assignment for sender identity grant administration", () => {
    assert.doesNotThrow(() =>
      assertMailSenderIdentityGrantManagement(
        actor({ adminGrants: ["address_assignment"] }),
      ),
    );
  });

  it("allows delivery_health and super_admin for delivery health helper", () => {
    assert.doesNotThrow(() =>
      assertMailDeliveryHealth(actor({ adminGrants: ["delivery_health"] })),
    );
    assert.doesNotThrow(() =>
      assertMailDeliveryHealth(actor({ adminGrants: ["super_admin"] })),
    );
    assert.throws(() =>
      assertMailDeliveryHealth(actor({ adminGrants: ["account_mgmt"] })),
    );
    assert.throws(() =>
      assertMailDeliveryHealth(actor({ adminGrants: ["global_mail_read"] })),
    );
    assert.throws(() =>
      assertMailDeliveryHealth(actor({ adminGrants: ["approval_review"] })),
    );
  });

  it("hasMailDeliveryHealth includes delegated grant without mail access row", () => {
    assert.equal(
      hasMailDeliveryHealth(actor({ adminGrants: ["delivery_health"] })),
      true,
    );
    assert.equal(
      hasMailDeliveryHealth(
        actor({ crmRole: "staff", adminGrants: ["delivery_health"], mailAccessEnabled: false }),
      ),
      true,
    );
    assert.equal(
      hasMailDeliveryHealth(
        actor({ crmRole: "admin", mailAccessEnabled: false }),
      ),
      true,
    );
  });

  it("allows CRM root admin for inbound fallback without super_admin grant", () => {
    assert.doesNotThrow(() =>
      assertMailInboundFallbackConfigManagement(
        actor({ crmRole: "admin", adminGrants: [] }),
      ),
    );
  });

  it("denies staff without super_admin for inbound fallback", () => {
    assert.throws(() =>
      assertMailInboundFallbackConfigManagement(
        actor({ crmRole: "staff", adminGrants: ["delivery_health"] }),
      ),
    );
    assert.throws(() =>
      assertMailInboundFallbackConfigManagement(
        actor({ crmRole: "staff", adminGrants: ["account_mgmt"] }),
      ),
    );
  });
});

describe("personal mailbox owner eligibility", () => {
  it("includes any active CRM user regardless of Mail access", () => {
    assert.equal(
      isEligiblePersonalMailboxOwner({
        userStatus: "active",
      }),
      true,
    );
  });

  it("includes active staff without mail_user_access", () => {
    assert.equal(
      isEligiblePersonalMailboxOwner({
        userStatus: "active",
      }),
      true,
    );
  });

  it("includes active root admin without mail_user_access", () => {
    assert.equal(
      isEligiblePersonalMailboxOwner({
        userStatus: "active",
      }),
      true,
    );
  });

  it("excludes inactive and disabled users", () => {
    assert.equal(
      isEligiblePersonalMailboxOwner({
        userStatus: "disabled",
      }),
      false,
    );
    assert.equal(
      isEligiblePersonalMailboxOwner({
        userStatus: "deleted",
      }),
      false,
    );
  });
});

describe("assertNotificationIdentityTargetAccess", () => {
  it("allows mail-enabled staff to manage own notification identity", () => {
    assert.doesNotThrow(() =>
      assertNotificationIdentityTargetAccess(
        actor({ userId: "user-1", mailAccessEnabled: true }),
        "user-1",
      ),
    );
  });

  it("denies staff without mail access for own notification identity", () => {
    assert.throws(
      () =>
        assertNotificationIdentityTargetAccess(
          actor({ userId: "user-1", mailAccessEnabled: false }),
          "user-1",
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("denies staff cross-user notification identity access", () => {
    assert.throws(
      () =>
        assertNotificationIdentityTargetAccess(
          actor({ userId: "user-1", mailAccessEnabled: true }),
          "user-2",
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("allows permission_mgmt admin to manage another user", () => {
    assert.doesNotThrow(() =>
      assertNotificationIdentityTargetAccess(
        actor({
          userId: "admin-1",
          adminGrants: ["permission_mgmt"],
        }),
        "user-2",
      ),
    );
  });
});

describe("notification identity security management", () => {
  it("denies staff identity revocation even for their own identity", () => {
    assert.throws(
      () =>
        assertNotificationIdentitySecurityManagement(
          actor({ userId: "user-1", mailAccessEnabled: true }),
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("allows permission administrators to revoke identities", () => {
    assert.doesNotThrow(() =>
      assertNotificationIdentitySecurityManagement(
        actor({ adminGrants: ["permission_mgmt"] }),
      ),
    );
  });
});
