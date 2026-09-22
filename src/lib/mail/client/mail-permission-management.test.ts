import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  adminGrantRevokePath,
  adminGrantsPath,
  buildMailPermissionGrantRows,
  buildMailPermissionUserRows,
  canManageMailPermissions,
  canManageSuperAdminGrants,
  canRevokeMailAdminGrant,
  isRootCrmAdminUser,
  listGrantableMailAdminPermissions,
  mailAdminPermissionLabelKey,
  resolveMailPermissionApiFeedback,
  type MailAdminGrantApiItem,
} from "@/lib/mail/client/mail-permission-management";

const USERS = [
  {
    id: "admin-1",
    name: "Root Admin",
    email: "admin@example.com",
    role: "admin" as const,
    status: "active" as const,
  },
  {
    id: "staff-1",
    name: "Staff User",
    email: "staff@example.com",
    role: "staff" as const,
    status: "active" as const,
  },
];

const ACCESS = [
  {
    userId: "staff-1",
    isEnabled: 1,
    enabledAt: "2026-08-22T08:00:00.000Z",
    disabledAt: null,
    createdAt: "2026-08-21T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    hasVerifiedNotificationIdentity: true,
  },
];

function grant(
  overrides: Partial<MailAdminGrantApiItem> & Pick<MailAdminGrantApiItem, "id" | "userId" | "permission">,
): MailAdminGrantApiItem {
  const now = "2026-08-22T08:00:00.000Z";
  return {
    grantedBy: "admin-1",
    grantedAt: now,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("canManageMailPermissions", () => {
  it("returns false when permissionManagement capability is missing", () => {
    assert.equal(canManageMailPermissions({ permissionManagement: false }), false);
  });

  it("returns true when permissionManagement capability is granted", () => {
    assert.equal(canManageMailPermissions({ permissionManagement: true }), true);
  });
});

describe("canManageSuperAdminGrants", () => {
  it("allows CRM root admin", () => {
    assert.equal(
      canManageSuperAdminGrants({
        isCrmRootAdmin: true,
        capabilities: { proofDiagnostics: false },
      }),
      true,
    );
  });

  it("allows delegated super_admin via proof diagnostics capability", () => {
    assert.equal(
      canManageSuperAdminGrants({
        isCrmRootAdmin: false,
        capabilities: { proofDiagnostics: true },
      }),
      true,
    );
  });
});

describe("buildMailPermissionUserRows", () => {
  it("marks CRM root admin and staff mail access lifecycle", () => {
    const grantsByUserId = new Map([
      [
        "staff-1",
        [
          grant({
            id: "grant-1",
            userId: "staff-1",
            permission: "approval_review",
          }),
        ],
      ],
    ]);
    const rows = buildMailPermissionUserRows(USERS, ACCESS, grantsByUserId);
    const admin = rows.find((row) => row.userId === "admin-1");
    const staff = rows.find((row) => row.userId === "staff-1");
    assert.equal(admin?.isRootCrmAdmin, true);
    assert.equal(admin?.mailAccessLifecycle, "not_configured");
    assert.equal(staff?.mailAccessLifecycle, "enabled");
    assert.equal(staff?.explicitGrantCount, 1);
  });
});

describe("buildMailPermissionGrantRows", () => {
  it("renders active grants in display order", () => {
    const rows = buildMailPermissionGrantRows([
      grant({
        id: "grant-2",
        userId: "staff-1",
        permission: "approval_review",
      }),
      grant({
        id: "grant-1",
        userId: "staff-1",
        permission: "permission_mgmt",
      }),
    ]);
    assert.deepEqual(
      rows.map((row) => row.permission),
      ["permission_mgmt", "approval_review"],
    );
  });

  it("renders empty state when no active grants exist", () => {
    assert.deepEqual(buildMailPermissionGrantRows([]), []);
  });
});

describe("listGrantableMailAdminPermissions", () => {
  it("hides super_admin when actor cannot manage super admin grants", () => {
    const available = listGrantableMailAdminPermissions({
      canManageSuperAdmin: false,
      existingPermissions: new Set(),
      targetIsRootCrmAdmin: false,
    });
    assert.equal(available.includes("super_admin"), false);
    assert.equal(available.includes("permission_mgmt"), true);
  });

  it("returns no grantable permissions for root CRM admin target", () => {
    const available = listGrantableMailAdminPermissions({
      canManageSuperAdmin: true,
      existingPermissions: new Set(),
      targetIsRootCrmAdmin: true,
    });
    assert.deepEqual(available, []);
  });
});

describe("canRevokeMailAdminGrant", () => {
  it("blocks revoke for root CRM admin targets", () => {
    assert.equal(
      canRevokeMailAdminGrant({
        permission: "permission_mgmt",
        targetIsRootCrmAdmin: true,
        canManageSuperAdmin: true,
      }),
      false,
    );
  });

  it("blocks super_admin revoke without super admin authority", () => {
    assert.equal(
      canRevokeMailAdminGrant({
        permission: "super_admin",
        targetIsRootCrmAdmin: false,
        canManageSuperAdmin: false,
      }),
      false,
    );
  });
});

describe("resolveMailPermissionApiFeedback", () => {
  it("maps forbidden and conflict responses", () => {
    assert.equal(
      resolveMailPermissionApiFeedback({ status: 403, errorCode: "FORBIDDEN" }).kind,
      "permissionDenied",
    );
    assert.equal(
      resolveMailPermissionApiFeedback({ status: 409, errorCode: "CONFLICT" }).kind,
      "conflict",
    );
    assert.equal(
      resolveMailPermissionApiFeedback({ status: 500 }).kind,
      "genericError",
    );
  });
});

describe("mail permission API paths", () => {
  it("uses existing admin grant routes", () => {
    assert.equal(
      adminGrantsPath("user-1"),
      "/api/mail/access/user-1/admin-grants",
    );
    assert.equal(
      adminGrantRevokePath("grant-1"),
      "/api/mail/admin-grants/grant-1/revoke",
    );
  });
});

describe("mail permission labels", () => {
  it("defines locale keys for all admin permissions", () => {
    const locales = ["zh-Hans", "zh-Hant", "en"] as const;
    for (const locale of locales) {
      const source = readFileSync(`src/i18n/locales/${locale}.ts`, "utf8");
      assert.match(source, /permission:\s*\{/);
      assert.match(source, /super_admin:/);
      assert.match(source, /permission_mgmt:/);
      assert.match(source, /approval_review:/);
      assert.match(source, /delivery_health:/);
    }
    assert.equal(
      mailAdminPermissionLabelKey("permission_mgmt"),
      "mail.adminCenter.permission.grants.permission_mgmt",
    );
  });
});

describe("mail permission management UI wiring", () => {
  it("replaces the permission placeholder with MailPermissionManagement", () => {
    const panel = readFileSync(
      "src/components/mail/admin/mail-admin-center-section-panel.tsx",
      "utf8",
    );
    const component = readFileSync(
      "src/components/mail/admin/mail-permission-management.tsx",
      "utf8",
    );
    const api = readFileSync("src/lib/mail/client/api.ts", "utf8");

    assert.match(panel, /MailPermissionManagement/);
    assert.doesNotMatch(panel, /PLACEHOLDER_SECTIONS = new Set<MailAdminCenterSectionId>\(\[\s*"permission"/);
    assert.match(component, /fetchAdminGrantsForUser/);
    assert.match(component, /postAdminGrant/);
    assert.match(component, /postAdminGrantRevoke/);
    assert.match(component, /inheritedAuthority/);
    assert.match(api, /fetchAdminGrantsForUser/);
    assert.match(api, /postAdminGrantRevoke/);
  });

  it("shows inherited authority for root CRM admin and blocks revoke UI", () => {
    const component = readFileSync(
      "src/components/mail/admin/mail-permission-management.tsx",
      "utf8",
    );
    assert.equal(isRootCrmAdminUser({ role: "admin" }), true);
    assert.match(component, /targetIsRootCrmAdmin/);
    assert.match(component, /canRevokeMailAdminGrant/);
    assert.match(component, /rootAdminGrantHint/);
  });

  it("portals member detail drawer to document.body above admin center", () => {
    const component = readFileSync(
      "src/components/mail/admin/mail-permission-management.tsx",
      "utf8",
    );
    const drawer = readFileSync("src/components/ui/quick-entry-drawer.tsx", "utf8");
    const globals = readFileSync("src/app/globals.css", "utf8");

    assert.match(component, /createPortal/);
    assert.match(component, /document\.body/);
    assert.match(component, /qe-drawer-root--stacked/);
    assert.match(component, /mail-permission-detail-panel/);
    assert.match(drawer, /rootClassName/);
    assert.match(globals, /\.qe-drawer-root--stacked/);
  });
});

describe("mail permission mobile layout", () => {
  it("resets admin center content scroll when section changes", () => {
    const drawer = readFileSync(
      "src/components/mail/admin/mail-admin-center-drawer.tsx",
      "utf8",
    );
    const globals = readFileSync("src/app/globals.css", "utf8");

    assert.match(drawer, /contentRef/);
    assert.match(drawer, /scrollTo\(\{ top: 0 \}\)/);
    assert.match(globals, /@media \(max-width: 767px\)[\s\S]*\.mail-admin-center-content[\s\S]*flex: 1 1 auto/);
    assert.match(globals, /\.mail-admin-center-content[\s\S]*flex: 1 1 auto/);
  });

  it("keeps inherited admin and empty delegated notices in detail panel", () => {
    const component = readFileSync(
      "src/components/mail/admin/mail-permission-management.tsx",
      "utf8",
    );

    assert.match(component, /inheritedAuthorityTitle/);
    assert.match(component, /inheritedAuthorityDescription/);
    assert.match(component, /detailNoGrants/);
    assert.match(component, /addGrantTitle/);
  });
});
