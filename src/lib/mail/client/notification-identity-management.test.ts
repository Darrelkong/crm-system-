import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  canIssueSelfVerificationToken,
  canManageNotificationIdentity,
  clearVerificationTokenModalPayload,
  filterSelfNotificationIdentities,
  resolveNotificationIdentityDisplayStatus,
  resolveNotificationIdentityManagementActions,
  resolveNotificationIdentitySurfaceActions,
  resolveNotificationIdentityUxPhase,
  resolvePrimaryNotificationIdentity,
  buildNotificationIdentityTeamOverviewRows,
  filterNotificationIdentityTeamOverviewRows,
  resolveNotificationIdentityTeamOverviewRowActions,
  resolveNotificationIdentityTeamOverviewPrimaryAction,
  isActiveCrmTeamMember,
  shouldRenderDuplicatePrimaryIdentitySummary,
  shouldShowAdvancedVerificationTools,
  type NotificationIdentityApiItem,
} from "@/lib/mail/client/notification-identity-management";

function identity(
  overrides: Partial<NotificationIdentityApiItem> = {},
): NotificationIdentityApiItem {
  return {
    id: "identity-1",
    userId: "self-user",
    email: "notify@example.com",
    verificationStatus: "pending",
    verificationRequestedAt: "2026-08-22T08:00:00.000Z",
    verificationExpiresAt: "2026-08-23T08:00:00.000Z",
    verificationAttemptCount: 0,
    verifiedAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    deliveryHealth: "unknown",
    deliveryProblemAt: null,
    lastDeliveryStatus: null,
    lastDeliveryAt: null,
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    verificationPending: true,
    ...overrides,
  };
}

describe("canManageNotificationIdentity", () => {
  it("hides management when notificationIdentityManagement is false", () => {
    assert.equal(
      canManageNotificationIdentity({ notificationIdentityManagement: false }),
      false,
    );
  });
});

describe("resolveNotificationIdentityDisplayStatus", () => {
  it("returns pending for active pending identity", () => {
    assert.equal(
      resolveNotificationIdentityDisplayStatus(identity()),
      "pending",
    );
  });

  it("returns verified for active verified identity", () => {
    assert.equal(
      resolveNotificationIdentityDisplayStatus(
        identity({
          verificationStatus: "verified",
          verificationPending: false,
          verifiedAt: "2026-08-22T09:00:00.000Z",
        }),
      ),
      "verified",
    );
  });

  it("returns bounced when verified identity has bounced delivery health", () => {
    assert.equal(
      resolveNotificationIdentityDisplayStatus(
        identity({
          verificationStatus: "verified",
          verificationPending: false,
          verifiedAt: "2026-08-22T09:00:00.000Z",
          deliveryHealth: "bounced",
        }),
      ),
      "bounced",
    );
  });
});

describe("resolveNotificationIdentityManagementActions", () => {
  const pending = identity();

  it("hides actions without notification identity management permission", () => {
    assert.deepEqual(
      resolveNotificationIdentityManagementActions({
        canManage: false,
        canIssueToken: true,
        pending,
      }),
      {
        showAddEmail: false,
        showIssueToken: false,
        showVerify: false,
      },
    );
  });

  it("shows issue token action for pending identity when proof permission exists", () => {
    assert.deepEqual(
      resolveNotificationIdentityManagementActions({
        canManage: true,
        canIssueToken: true,
        pending,
      }),
      {
        showAddEmail: false,
        showIssueToken: true,
        showVerify: false,
      },
    );
  });

  it("hides inline verify action even when pending identity exists", () => {
    assert.deepEqual(
      resolveNotificationIdentityManagementActions({
        canManage: true,
        canIssueToken: false,
        pending,
      }),
      {
        showAddEmail: false,
        showIssueToken: false,
        showVerify: false,
      },
    );
  });

  it("shows add email when no active pending identity exists", () => {
    assert.deepEqual(
      resolveNotificationIdentityManagementActions({
        canManage: true,
        canIssueToken: true,
        pending: null,
      }),
      {
        showAddEmail: true,
        showIssueToken: false,
        showVerify: false,
      },
    );
  });
});

describe("filterSelfNotificationIdentities", () => {
  it("drops identities belonging to other users", () => {
    const rows = filterSelfNotificationIdentities(
      [
        identity({ userId: "self-user" }),
        identity({ id: "identity-2", userId: "other-user" }),
      ],
      "self-user",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.userId, "self-user");
  });
});

describe("clearVerificationTokenModalPayload", () => {
  it("clears one-time token modal state", () => {
    assert.equal(clearVerificationTokenModalPayload(), null);
  });
});

describe("resolveNotificationIdentityUxPhase", () => {
  it("returns empty when no identities exist", () => {
    assert.equal(resolveNotificationIdentityUxPhase([]), "empty");
  });

  it("returns pending for active pending identity", () => {
    assert.equal(resolveNotificationIdentityUxPhase([identity()]), "pending");
  });

  it("returns verified for active verified identity", () => {
    assert.equal(
      resolveNotificationIdentityUxPhase([
        identity({
          verificationStatus: "verified",
          verificationPending: false,
          verifiedAt: "2026-08-22T09:00:00.000Z",
        }),
      ]),
      "verified",
    );
  });
});

describe("resolvePrimaryNotificationIdentity", () => {
  it("prefers verified identity over pending", () => {
    const primary = resolvePrimaryNotificationIdentity([
      identity({ id: "pending-1", email: "pending@example.com" }),
      identity({
        id: "verified-1",
        email: "verified@example.com",
        verificationStatus: "verified",
        verificationPending: false,
        verifiedAt: "2026-08-22T09:00:00.000Z",
      }),
    ]);
    assert.equal(primary?.email, "verified@example.com");
  });
});

describe("shouldShowAdvancedVerificationTools", () => {
  it("hides advanced token tools for normal notification identity managers", () => {
    assert.equal(
      shouldShowAdvancedVerificationTools({
        canIssueToken: false,
        pending: identity(),
      }),
      false,
    );
    assert.equal(
      resolveNotificationIdentityManagementActions({
        canManage: true,
        canIssueToken: false,
        pending: identity(),
      }).showIssueToken,
      false,
    );
  });

  it("shows advanced token tools for super admin proof diagnostics", () => {
    assert.equal(
      shouldShowAdvancedVerificationTools({
        canIssueToken: true,
        pending: identity(),
      }),
      true,
    );
    assert.equal(canIssueSelfVerificationToken({ proofDiagnostics: true }), true);
    assert.equal(
      resolveNotificationIdentityManagementActions({
        canManage: true,
        canIssueToken: true,
        pending: identity(),
      }).showIssueToken,
      true,
    );
  });
});

describe("notification identity management UX wiring", () => {
  it("uses full team overview instead of selector-only browsing", () => {
    const source = readFileSync(
      "src/components/mail/admin/notification-identity-management.tsx",
      "utf8",
    );
    const overview = readFileSync(
      "src/components/mail/admin/notification-identity-team-overview.tsx",
      "utf8",
    );
    assert.match(source, /NotificationIdentityTeamOverview/);
    assert.doesNotMatch(source, /NotificationIdentityTeamMemberSelector/);
    assert.doesNotMatch(source, /selfOnlyHint/);
    assert.match(overview, /notification-identity-team-overview-table/);
    assert.match(overview, /OverviewMemberCell/);
    assert.doesNotMatch(overview, /TableShell/);
    assert.match(overview, /filterNotificationIdentityTeamOverviewRows/);
  });
});

describe("resolveNotificationIdentitySurfaceActions", () => {
  it("shows configure email when no identity exists", () => {
    assert.deepEqual(
      resolveNotificationIdentitySurfaceActions({
        verified: null,
        pending: null,
      }),
      {
        showConfigureEmail: true,
        showChangeEmail: false,
        showCompleteVerification: false,
        showResendVerification: false,
        showCancelPending: false,
        showDisable: false,
        isReplacementPending: false,
        isPendingOnly: false,
      },
    );
  });

  it("shows change email only for verified identity without pending", () => {
    const verified = identity({
      verificationStatus: "verified",
      verificationPending: false,
      verifiedAt: "2026-08-22T09:00:00.000Z",
    });
    assert.deepEqual(
      resolveNotificationIdentitySurfaceActions({
        verified,
        pending: null,
      }),
      {
        showConfigureEmail: false,
        showChangeEmail: true,
        showCompleteVerification: false,
        showResendVerification: false,
        showCancelPending: false,
        showDisable: true,
        isReplacementPending: false,
        isPendingOnly: false,
      },
    );
  });

  it("shows complete verification and resend for pending identity", () => {
    assert.deepEqual(
      resolveNotificationIdentitySurfaceActions({
        verified: null,
        pending: identity(),
      }),
      {
        showConfigureEmail: false,
        showChangeEmail: true,
        showCompleteVerification: true,
        showResendVerification: true,
        showCancelPending: true,
        showDisable: false,
        isReplacementPending: false,
        isPendingOnly: true,
      },
    );
  });

  it("shows distinct verified and pending replacement actions", () => {
    const verified = identity({
      id: "verified-1",
      email: "old@example.com",
      verificationStatus: "verified",
      verificationPending: false,
      verifiedAt: "2026-08-22T09:00:00.000Z",
    });
    const pending = identity({
      id: "pending-1",
      email: "new@example.com",
    });
    assert.deepEqual(
      resolveNotificationIdentitySurfaceActions({
        verified,
        pending,
      }),
      {
        showConfigureEmail: false,
        showChangeEmail: false,
        showCompleteVerification: true,
        showResendVerification: true,
        showCancelPending: true,
        showDisable: true,
        isReplacementPending: true,
        isPendingOnly: false,
      },
    );
    assert.equal(
      shouldRenderDuplicatePrimaryIdentitySummary([verified, pending]),
      true,
    );
  });
});

describe("notification identity team overview", () => {
  const users = [
    {
      id: "user-a",
      name: "Alice",
      email: "alice@example.com",
      status: "active" as const,
    },
    {
      id: "user-b",
      name: "Bob",
      email: "bob@example.com",
      status: "active" as const,
    },
    {
      id: "user-disabled",
      name: "Disabled",
      email: "disabled@example.com",
      status: "disabled" as const,
    },
  ];

  it("includes only active CRM members in the default overview", () => {
    const rows = buildNotificationIdentityTeamOverviewRows(users, [], new Map());
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.userId),
      ["user-a", "user-b"],
    );
  });

  it("shows unconfigured, pending, verified, and replacement states", () => {
    const identities = new Map([
      [
        "user-a",
        [
          identity({
            userId: "user-a",
            email: "verified@example.com",
            verificationStatus: "verified",
            verificationPending: false,
            verifiedAt: "2026-08-22T09:00:00.000Z",
          }),
          identity({
            id: "pending-replacement",
            userId: "user-a",
            email: "new@example.com",
          }),
        ],
      ],
      ["user-b", [identity({ userId: "user-b", email: "pending@example.com" })]],
    ]);
    const rows = buildNotificationIdentityTeamOverviewRows(
      users,
      [{ userId: "user-a", isEnabled: 1 }],
      identities,
    );
    const alice = rows.find((row) => row.userId === "user-a");
    const bob = rows.find((row) => row.userId === "user-b");
    assert.equal(alice?.replacementPending, true);
    assert.equal(alice?.mailAccessEnabled, true);
    assert.equal(bob?.filterStatus, "pending");
  });

  it("keeps mail-disabled active members visible", () => {
    const rows = buildNotificationIdentityTeamOverviewRows(users, [], new Map());
    const bob = rows.find((row) => row.userId === "user-b");
    assert.equal(bob?.mailAccessEnabled, false);
  });

  it("filters by search query and status", () => {
    const rows = buildNotificationIdentityTeamOverviewRows(
      users,
      [],
      new Map([
        ["user-a", [identity({ userId: "user-a", email: "notify@example.com" })]],
      ]),
    );
    assert.equal(
      filterNotificationIdentityTeamOverviewRows(rows, "alice", "all").length,
      1,
    );
    assert.equal(
      filterNotificationIdentityTeamOverviewRows(rows, "", "pending").length,
      1,
    );
    assert.equal(
      filterNotificationIdentityTeamOverviewRows(rows, "", "none").length,
      1,
    );
  });

  it("derives row actions for configure, verification, and manage flows", () => {
    const noneRow = buildNotificationIdentityTeamOverviewRows(users, [], new Map())[0]!;
    assert.deepEqual(resolveNotificationIdentityTeamOverviewRowActions(noneRow), {
      showManage: true,
      showConfigure: true,
      showCompleteVerification: false,
      showResendVerification: false,
    });
    assert.equal(
      resolveNotificationIdentityTeamOverviewPrimaryAction(noneRow),
      "configure",
    );
    const pendingRow = buildNotificationIdentityTeamOverviewRows(
      users,
      [],
      new Map([["user-a", [identity({ userId: "user-a" })]]]),
    )[0]!;
    assert.equal(
      resolveNotificationIdentityTeamOverviewPrimaryAction(pendingRow),
      "completeVerification",
    );
    const verifiedRow = buildNotificationIdentityTeamOverviewRows(
      users,
      [],
      new Map([
        [
          "user-a",
          [
            identity({
              userId: "user-a",
              verificationStatus: "verified",
              verificationPending: false,
              verifiedAt: "2026-08-22T09:00:00.000Z",
            }),
          ],
        ],
      ]),
    )[0]!;
    assert.equal(
      resolveNotificationIdentityTeamOverviewPrimaryAction(verifiedRow),
      "manage",
    );
  });

  it("treats disabled users as inactive CRM team members", () => {
    assert.equal(isActiveCrmTeamMember({ status: "active" }), true);
    assert.equal(isActiveCrmTeamMember({ status: "disabled" }), false);
  });
});
