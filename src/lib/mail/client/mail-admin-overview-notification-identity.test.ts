import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  resolveOverviewNotificationIdentitySummary,
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

describe("resolveOverviewNotificationIdentitySummary", () => {
  it("returns none when no identities exist", () => {
    assert.deepEqual(resolveOverviewNotificationIdentitySummary([]), {
      kind: "none",
    });
  });

  it("returns pending identity summary", () => {
    const summary = resolveOverviewNotificationIdentitySummary([
      identity({ email: "pending@example.com" }),
    ]);
    assert.deepEqual(summary, {
      kind: "identity",
      email: "pending@example.com",
      displayStatus: "pending",
      verifiedAt: null,
    });
  });

  it("prefers verified identity over pending", () => {
    const summary = resolveOverviewNotificationIdentitySummary([
      identity({ id: "pending-1", email: "pending@example.com" }),
      identity({
        id: "verified-1",
        email: "verified@example.com",
        verificationStatus: "verified",
        verificationPending: false,
        verifiedAt: "2026-08-22T09:00:00.000Z",
      }),
    ]);
    assert.deepEqual(summary, {
      kind: "identity",
      email: "verified@example.com",
      displayStatus: "verified",
      verifiedAt: "2026-08-22T09:00:00.000Z",
    });
  });

  it("returns revoked identity when no active identity exists", () => {
    const summary = resolveOverviewNotificationIdentitySummary([
      identity({
        email: "revoked@example.com",
        verificationStatus: "revoked",
        verificationPending: false,
        revokedAt: "2026-08-21T08:00:00.000Z",
      }),
    ]);
    assert.deepEqual(summary, {
      kind: "identity",
      email: "revoked@example.com",
      displayStatus: "revoked",
      verifiedAt: null,
    });
  });

  it("returns bounced status for verified identity with bounced delivery health", () => {
    const summary = resolveOverviewNotificationIdentitySummary([
      identity({
        email: "bounced@example.com",
        verificationStatus: "verified",
        verificationPending: false,
        verifiedAt: "2026-08-22T09:00:00.000Z",
        deliveryHealth: "bounced",
      }),
    ]);
    assert.deepEqual(summary, {
      kind: "identity",
      email: "bounced@example.com",
      displayStatus: "bounced",
      verifiedAt: "2026-08-22T09:00:00.000Z",
    });
  });
});

describe("overview notification identity card wiring", () => {
  it("loads self identity via session user id and handles API errors", () => {
    const source = readFileSync(
      "src/components/mail/admin/mail-admin-overview-notification-identity-card.tsx",
      "utf8",
    );
    assert.match(source, /fetchNotificationIdentities\(selfUserId\)/);
    assert.match(source, /filterSelfNotificationIdentities/);
    assert.match(source, /MailAdminErrorState/);
    assert.match(source, /MailAdminLoadingState/);
    assert.doesNotMatch(source, /verificationToken/);
  });
});
