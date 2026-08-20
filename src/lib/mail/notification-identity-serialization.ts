import type { MailNotificationIdentity } from "../../../drizzle/schema/mail-notification-identities";

/** Admin-safe notification identity view — no verification secrets. */
export type SafeNotificationIdentityAdminView = {
  id: string;
  userId: string;
  email: string;
  verificationStatus: MailNotificationIdentity["verificationStatus"];
  verificationRequestedAt: string | null;
  verificationExpiresAt: string | null;
  verifiedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  deliveryHealth: MailNotificationIdentity["deliveryHealth"];
  deliveryProblemAt: string | null;
  lastDeliveryStatus: string | null;
  lastDeliveryAt: string | null;
  createdAt: string;
  updatedAt: string;
  verificationPending: boolean;
};

const SECRET_FIELD_NAMES = [
  "verificationTokenHash",
  "verification_token_hash",
  "verificationToken",
  "token",
  "tokenHash",
  "challenge",
] as const;

export function toSafeNotificationIdentityAdminView(
  identity: MailNotificationIdentity,
): SafeNotificationIdentityAdminView {
  return {
    id: identity.id,
    userId: identity.userId,
    email: identity.email,
    verificationStatus: identity.verificationStatus,
    verificationRequestedAt: identity.verificationRequestedAt,
    verificationExpiresAt: identity.verificationExpiresAt,
    verifiedAt: identity.verifiedAt,
    revokedAt: identity.revokedAt,
    revokedBy: identity.revokedBy,
    revokeReason: identity.revokeReason,
    deliveryHealth: identity.deliveryHealth,
    deliveryProblemAt: identity.deliveryProblemAt,
    lastDeliveryStatus: identity.lastDeliveryStatus,
    lastDeliveryAt: identity.lastDeliveryAt,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
    verificationPending: identity.verificationStatus === "pending",
  };
}

export function assertNotificationIdentityResponseHasNoSecrets(
  payload: unknown,
): void {
  const json = JSON.stringify(payload);
  for (const field of SECRET_FIELD_NAMES) {
    if (json.includes(`"${field}"`)) {
      throw new Error(`Secret field leaked in response: ${field}`);
    }
  }
}
