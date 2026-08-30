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
  resolveNotificationIdentityUxPhase,
  resolvePrimaryNotificationIdentity,
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
        showVerify: true,
      },
    );
  });

  it("shows verify action but not issue token without proof permission", () => {
    assert.deepEqual(
      resolveNotificationIdentityManagementActions({
        canManage: true,
        canIssueToken: false,
        pending,
      }),
      {
        showAddEmail: false,
        showIssueToken: false,
        showVerify: true,
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
  it("separates normal verification from advanced proof token tools", () => {
    const source = readFileSync(
      "src/components/mail/admin/notification-identity-management.tsx",
      "utf8",
    );
    assert.match(source, /NotificationIdentityVerifyForm/);
    assert.match(source, /AdvancedVerificationTools/);
    assert.match(source, /verifyCodeLabel/);
    assert.match(source, /advancedTitle/);
    assert.match(source, /IdentityStatusPanel/);
    assert.doesNotMatch(source, /H\.3/);
    assert.doesNotMatch(source, /verifyTokenLabel/);
  });
});
