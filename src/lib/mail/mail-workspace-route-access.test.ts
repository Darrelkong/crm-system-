import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getMailWorkspaceLayoutRedirect,
  resolveMailWorkspaceDashboardHref,
} from "@/lib/mail/mail-workspace-route-access";
import {
  buildMailAdminCenterCapabilities,
  canAccessMailAdminCenter,
} from "@/lib/mail/mail-session-context";
import type { MailActorContext } from "@/lib/mail/actor-context";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";
import { resolveMailReadSource } from "@/lib/mail/client/mail-read-source";

function actor(
  grants: MailAdminPermission[] = [],
  options: {
    mailAccessEnabled?: boolean;
    crmRole?: "admin" | "staff";
  } = {},
): MailActorContext {
  return {
    userId: "user-1",
    sessionId: null,
    crmRole: options.crmRole ?? "staff",
    mailAccessEnabled: options.mailAccessEnabled ?? true,
    adminGrants: grants,
    audit: {},
  };
}

describe("mail workspace route access", () => {
  it("redirects unauthenticated users to login with mail return path", () => {
    assert.equal(getMailWorkspaceLayoutRedirect(null), "/login?redirect=/mail");
  });

  it("allows admin CRM users into the mail workspace route", () => {
    assert.equal(
      getMailWorkspaceLayoutRedirect({
        id: "admin-1",
        role: "admin",
      }),
      null,
    );
  });

  it("allows staff CRM users into the mail workspace route", () => {
    assert.equal(
      getMailWorkspaceLayoutRedirect({
        id: "staff-1",
        role: "staff",
      }),
      null,
    );
  });

  it("resolves role-appropriate dashboard hrefs for no-access states", () => {
    assert.equal(resolveMailWorkspaceDashboardHref("admin"), "/admin");
    assert.equal(resolveMailWorkspaceDashboardHref("staff"), "/staff");
  });
});

describe("mail workspace vs admin center separation", () => {
  it("allows staff with mail access but no admin grants into workspace semantics only", () => {
    const capabilities = buildMailAdminCenterCapabilities(actor([]));
    assert.equal(capabilities.approvalWorkflowView, true);
    assert.equal(canAccessMailAdminCenter(capabilities), false);
  });

  it("denies mail admin center for approval-only staff", () => {
    const capabilities = buildMailAdminCenterCapabilities(
      actor(["approval_review"]),
    );
    assert.equal(capabilities.approvalReviewManagement, true);
    assert.equal(canAccessMailAdminCenter(capabilities), false);
  });

  it("does not grant mail admin center to global_mail_read alone", () => {
    const capabilities = buildMailAdminCenterCapabilities(
      actor(["global_mail_read"]),
    );
    assert.equal(capabilities.overview, true);
    assert.equal(canAccessMailAdminCenter(capabilities), false);
  });

  it("does not imply mail access from CRM admin role alone", () => {
    const capabilities = buildMailAdminCenterCapabilities(
      actor([], { crmRole: "admin", mailAccessEnabled: false }),
    );
    assert.equal(capabilities.canAccessMailAdminCenter, false);
    assert.equal(capabilities.approvalWorkflowView, false);
  });

  it("allows mail admin center only with explicit admin entry grants", () => {
    assert.equal(
      canAccessMailAdminCenter(
        buildMailAdminCenterCapabilities(actor(["permission_mgmt"])),
      ),
      true,
    );
  });

  it("leaves production read source default unchanged", () => {
    assert.equal(resolveMailReadSource(), "prototype");
  });
});
