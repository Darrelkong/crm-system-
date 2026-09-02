import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  buildMailAdminCenterCapabilities,
  buildMailSessionContext,
  canAccessMailAdminCenter,
  getVisibleMailAdminCenterSections,
  listEnabledMailAdminCapabilityKeys,
  resolveDefaultMailAdminCenterSection,
} from "@/lib/mail/mail-session-context";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

function actor(
  grants: MailAdminPermission[] = [],
  mailAccessEnabled = true,
  crmRole: "admin" | "staff" = "staff",
): MailActorContext {
  return {
    userId: "user-1",
    sessionId: null,
    crmRole,
    mailAccessEnabled,
    adminGrants: grants,
    audit: {},
  };
}

describe("buildMailAdminCenterCapabilities", () => {
  it("returns full capabilities for CRM root admin without mail access", () => {
    const capabilities = buildMailAdminCenterCapabilities(
      actor(["super_admin"], false, "admin"),
    );
    assert.equal(capabilities.canAccessMailAdminCenter, true);
    assert.equal(capabilities.accessManagement, true);
    assert.equal(capabilities.mailboxManagement, true);
  });

  it("returns grant-based capabilities for delegated admin without mail access", () => {
    const capabilities = buildMailAdminCenterCapabilities(
      actor(["permission_mgmt"], false),
    );
    assert.equal(capabilities.canAccessMailAdminCenter, true);
    assert.equal(capabilities.accessManagement, true);
    assert.equal(capabilities.approvalWorkflowView, false);
  });

  it("returns no capabilities for staff without mail access or grants", () => {
    const capabilities = buildMailAdminCenterCapabilities(
      actor([], false, "staff"),
    );
    assert.equal(capabilities.canAccessMailAdminCenter, false);
    assert.equal(capabilities.overview, false);
  });

  it("maps permission_mgmt to access, notification identity, and permission sections", () => {
    const capabilities = buildMailAdminCenterCapabilities(
      actor(["permission_mgmt"]),
    );
    assert.equal(capabilities.canAccessMailAdminCenter, true);
    assert.equal(capabilities.overview, true);
    assert.equal(capabilities.accessManagement, true);
    assert.equal(capabilities.notificationIdentityManagement, true);
    assert.equal(capabilities.permissionManagement, true);
    assert.equal(capabilities.proofDiagnostics, false);
    assert.equal(capabilities.senderIdentityManagement, false);
    assert.equal(capabilities.mailboxManagement, false);
    assert.equal(capabilities.deliveryHealth, false);
  });

  it("maps super_admin to proof diagnostics and implied admin sections", () => {
    const capabilities = buildMailAdminCenterCapabilities(
      actor(["super_admin"]),
    );
    assert.equal(capabilities.canAccessMailAdminCenter, true);
    assert.equal(capabilities.overview, true);
    assert.equal(capabilities.accessManagement, true);
    assert.equal(capabilities.notificationIdentityManagement, true);
    assert.equal(capabilities.proofDiagnostics, true);
    assert.equal(capabilities.senderIdentityManagement, true);
    assert.equal(capabilities.mailboxManagement, true);
    assert.equal(capabilities.signatureTemplateManagement, true);
    assert.equal(capabilities.approvalReviewManagement, true);
    assert.equal(capabilities.approvalWorkflowView, true);
    assert.equal(capabilities.permissionManagement, true);
    assert.equal(capabilities.deliveryHealth, true);
  });

  it("maps granular grants to their admin center sections only", () => {
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["account_mgmt"]))
        .canAccessMailAdminCenter,
      true,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["account_mgmt"])).mailboxManagement,
      true,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["account_mgmt"]))
        .senderIdentityManagement,
      false,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["address_assignment"]))
        .canAccessMailAdminCenter,
      true,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["address_assignment"]))
        .senderIdentityManagement,
      true,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["signature_template"]))
        .canAccessMailAdminCenter,
      true,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["signature_template"]))
        .signatureTemplateManagement,
      true,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["signature_template"]))
        .senderIdentityManagement,
      false,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["approval_review"]))
        .approvalReviewManagement,
      true,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["approval_review"]))
        .approvalWorkflowView,
      true,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["approval_review"]))
        .canAccessMailAdminCenter,
      false,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["delivery_health"]))
        .canAccessMailAdminCenter,
      true,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["delivery_health"]))
        .deliveryHealth,
      true,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["global_mail_read"])).overview,
      true,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["global_mail_read"]))
        .canAccessMailAdminCenter,
      false,
    );
    assert.equal(
      buildMailAdminCenterCapabilities(actor(["global_mail_read"]))
        .accessManagement,
      false,
    );
  });

  it("returns workflow view without admin center entry for mail access without admin grants", () => {
    const capabilities = buildMailAdminCenterCapabilities(actor([]));
    assert.deepEqual(capabilities, {
      canAccessMailAdminCenter: false,
      overview: false,
      accessManagement: false,
      notificationIdentityManagement: false,
      proofDiagnostics: false,
      senderIdentityManagement: false,
      signatureTemplateManagement: false,
      approvalReviewManagement: false,
      approvalWorkflowView: true,
      mailboxManagement: false,
      permissionManagement: false,
      deliveryHealth: false,
    });
  });
});

describe("mail admin center sections", () => {
  it("lists visible sections from capabilities", () => {
    const sections = getVisibleMailAdminCenterSections(
      buildMailAdminCenterCapabilities(actor(["permission_mgmt"])),
    );
    assert.deepEqual(sections, [
      "overview",
      "access",
      "notificationIdentity",
      "approval",
      "permission",
    ]);
  });

  it("still lists approval section for staff with workflow view only", () => {
    const sections = getVisibleMailAdminCenterSections(
      buildMailAdminCenterCapabilities(actor([])),
    );
    assert.deepEqual(sections, ["approval"]);
  });

  it("resolves default section as first visible section", () => {
    assert.equal(
      resolveDefaultMailAdminCenterSection(
        buildMailAdminCenterCapabilities(actor(["delivery_health"])),
      ),
      "overview",
    );
  });

  it("gates admin center entry on canAccessMailAdminCenter capability", () => {
    assert.equal(
      canAccessMailAdminCenter(
        buildMailAdminCenterCapabilities(actor(["permission_mgmt"])),
      ),
      true,
    );
    assert.equal(
      canAccessMailAdminCenter(
        buildMailAdminCenterCapabilities(actor(["global_mail_read"])),
      ),
      false,
    );
    assert.equal(
      canAccessMailAdminCenter(buildMailAdminCenterCapabilities(actor([]))),
      false,
    );
    assert.equal(
      canAccessMailAdminCenter(
        buildMailAdminCenterCapabilities(actor(["approval_review"])),
      ),
      false,
    );
  });

  it("lists enabled capability keys in stable order", () => {
    assert.deepEqual(
      listEnabledMailAdminCapabilityKeys(
        buildMailAdminCenterCapabilities(actor(["permission_mgmt"])),
      ),
      [
        "overview",
        "accessManagement",
        "notificationIdentityManagement",
        "approvalWorkflowView",
        "permissionManagement",
      ],
    );
  });
});

describe("buildMailSessionContext", () => {
  it("maps user fields and actor state into session context", () => {
    const context = buildMailSessionContext(
      {
        id: "staff-1",
        email: "staff@example.com",
        displayName: "Staff User",
      },
      actor(["permission_mgmt"], true, "staff"),
    );

    assert.deepEqual(context, {
      user: {
        id: "staff-1",
        email: "staff@example.com",
        name: "Staff User",
      },
      mailAccessEnabled: true,
      effectiveMailAccessEnabled: true,
      mailboxState: "none",
      notificationIdentityState: "missing",
      effectiveState: "READY",
      canUseMailbox: true,
      canUseMailAdmin: true,
      effectiveGlobalMailRead: false,
      isCrmRootAdmin: false,
      capabilities: buildMailAdminCenterCapabilities(
        actor(["permission_mgmt"], true, "staff"),
      ),
    });
  });
});
