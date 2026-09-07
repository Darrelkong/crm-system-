import type {
  MailLargeAttachmentDeliveryTokenState,
} from "../../../../drizzle/schema/mail-large-attachment-delivery-tokens";

export type LargeAttachmentDeliveryTokenRecord = {
  id: string;
  state: MailLargeAttachmentDeliveryTokenState;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  armedAt: string | null;
  confirmedAt: string | null;
  revokedAt: string | null;
  providerMessageId: string | null;
  providerAcceptedAt: string | null;
};

export class LargeAttachmentDeliveryTokenTransitionError extends Error {
  readonly code = "INVALID_LARGE_ATTACHMENT_DELIVERY_TOKEN_TRANSITION" as const;
}

function assertState(
  token: LargeAttachmentDeliveryTokenRecord,
  expected: MailLargeAttachmentDeliveryTokenState,
): void {
  if (token.state !== expected) {
    throw new LargeAttachmentDeliveryTokenTransitionError(
      `Invalid delivery token transition from ${token.state}; expected ${expected}`,
    );
  }
}

export function transitionPreparedToArmed(
  token: LargeAttachmentDeliveryTokenRecord,
  armedAt: string,
): LargeAttachmentDeliveryTokenRecord {
  assertState(token, "prepared");
  return { ...token, state: "armed", armedAt };
}

export function transitionArmedToConfirmed(
  token: LargeAttachmentDeliveryTokenRecord,
  input: { confirmedAt: string; providerMessageId: string; providerAcceptedAt: string },
): LargeAttachmentDeliveryTokenRecord {
  assertState(token, "armed");
  return {
    ...token,
    state: "confirmed",
    confirmedAt: input.confirmedAt,
    providerMessageId: input.providerMessageId,
    providerAcceptedAt: input.providerAcceptedAt,
  };
}

export function transitionArmedToRevoked(
  token: LargeAttachmentDeliveryTokenRecord,
  revokedAt: string,
): LargeAttachmentDeliveryTokenRecord {
  if (
    token.state !== "prepared" &&
    token.state !== "armed" &&
    token.state !== "confirmed"
  ) {
    throw new LargeAttachmentDeliveryTokenTransitionError(
      `Invalid delivery token revoke from ${token.state}`,
    );
  }
  return {
    ...token,
    state: "revoked",
    confirmedAt: null,
    providerMessageId: null,
    providerAcceptedAt: null,
    revokedAt,
  };
}

export function transitionArmedToExpired(
  token: LargeAttachmentDeliveryTokenRecord,
): LargeAttachmentDeliveryTokenRecord {
  if (
    token.state !== "prepared" &&
    token.state !== "armed" &&
    token.state !== "confirmed"
  ) {
    throw new LargeAttachmentDeliveryTokenTransitionError(
      `Invalid delivery token expiry from ${token.state}`,
    );
  }
  return {
    ...token,
    state: "expired",
    // A prepared row is only observable if a crash interrupted the
    // prepare/arm batch. The schema requires armed_at for expired rows;
    // preserve the original creation time without changing expiry.
    armedAt: token.armedAt ?? token.createdAt,
  };
}
