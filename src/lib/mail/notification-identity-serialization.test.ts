import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailNotificationIdentity } from "../../../drizzle/schema/mail-notification-identities";
import {
  assertNotificationIdentityResponseHasNoSecrets,
  toSafeNotificationIdentityAdminView,
} from "@/lib/mail/notification-identity-serialization";

function sampleIdentity(
  overrides: Partial<MailNotificationIdentity> = {},
): MailNotificationIdentity {
  return {
    id: "identity-1",
    userId: "user-1",
    email: "user@gmail.com",
    verificationStatus: "pending",
    verificationTokenHash: "abc123hash",
    verificationRequestedAt: "2026-08-20T10:00:00.000Z",
    verificationExpiresAt: "2026-08-21T10:00:00.000Z",
    verifiedAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    deliveryHealth: "unknown",
    deliveryProblemAt: null,
    lastDeliveryStatus: null,
    lastDeliveryAt: null,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("notification identity serialization", () => {
  it("strips verification token hash from admin view", () => {
    const safe = toSafeNotificationIdentityAdminView(sampleIdentity());
    assert.equal(safe.id, "identity-1");
    assert.equal(safe.verificationPending, true);
    assert.equal(
      (safe as Record<string, unknown>).verificationTokenHash,
      undefined,
    );
  });

  it("create API response shape contains no secret fields", () => {
    const safe = toSafeNotificationIdentityAdminView(sampleIdentity());
    const response = { item: safe };
    assert.doesNotThrow(() =>
      assertNotificationIdentityResponseHasNoSecrets(response),
    );
  });

  it("rejects payloads containing secret field names", () => {
    assert.throws(() =>
      assertNotificationIdentityResponseHasNoSecrets({
        item: { verificationToken: "secret" },
      }),
    );
    assert.throws(() =>
      assertNotificationIdentityResponseHasNoSecrets({
        item: { verificationTokenHash: "hash" },
      }),
    );
  });
});
