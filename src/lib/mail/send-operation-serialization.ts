import type { MailOutboundRfcIdentity } from "../../../drizzle/schema/mail-outbound-rfc-identities";
import type { MailSendOperation } from "../../../drizzle/schema/mail-send-operations";
import type { MailTransportAttempt } from "../../../drizzle/schema/mail-transport-attempts";

export type SafeTransportAttemptView = {
  id: string;
  attemptNumber: number;
  state: MailTransportAttempt["state"];
  provider: string;
  providerRequestId: string | null;
  providerMessageId: string | null;
  startedAt: string;
  completedAt: string | null;
  retryAfterAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type SafeRfcIdentityView = {
  id: string;
  rfcMessageId: string;
  createdAt: string;
};

export type SafeSendOperationView = {
  id: string;
  outboundRevisionId: string;
  revisionChainId: string;
  contentHash: string;
  hashVersion: number;
  revisionKind: MailSendOperation["revisionKind"];
  authorizationMode: MailSendOperation["authorizationMode"];
  approvalId: string | null;
  idempotencyKey: string;
  status: MailSendOperation["status"];
  orchestrationVersion: number;
  initiatedByUserId: string | null;
  createdAt: string;
  completedAt: string | null;
  nextAttemptAt: string | null;
  rfcIdentity?: SafeRfcIdentityView;
  transportAttempts?: SafeTransportAttemptView[];
};

export function toSafeTransportAttemptView(
  attempt: MailTransportAttempt,
): SafeTransportAttemptView {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    state: attempt.state,
    provider: attempt.provider,
    providerRequestId: attempt.providerRequestId,
    providerMessageId: attempt.providerMessageId,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    retryAfterAt: attempt.retryAfterAt,
    errorCode: attempt.errorCode,
    errorMessage: attempt.errorMessage,
  };
}

export function toSafeRfcIdentityView(
  identity: MailOutboundRfcIdentity,
): SafeRfcIdentityView {
  return {
    id: identity.id,
    rfcMessageId: identity.rfcMessageId,
    createdAt: identity.createdAt,
  };
}

export function toSafeSendOperationView(
  send: MailSendOperation,
  extras?: {
    rfcIdentity?: MailOutboundRfcIdentity | null;
    transportAttempts?: MailTransportAttempt[];
  },
): SafeSendOperationView {
  return {
    id: send.id,
    outboundRevisionId: send.outboundRevisionId,
    revisionChainId: send.revisionChainId,
    contentHash: send.contentHash,
    hashVersion: send.hashVersion,
    revisionKind: send.revisionKind,
    authorizationMode: send.authorizationMode,
    approvalId: send.approvalId,
    idempotencyKey: send.idempotencyKey,
    status: send.status,
    orchestrationVersion: send.orchestrationVersion,
    initiatedByUserId: send.initiatedByUserId,
    createdAt: send.createdAt,
    completedAt: send.completedAt,
    nextAttemptAt: send.nextAttemptAt,
    ...(extras?.rfcIdentity
      ? { rfcIdentity: toSafeRfcIdentityView(extras.rfcIdentity) }
      : {}),
    ...(extras?.transportAttempts
      ? {
          transportAttempts: extras.transportAttempts.map(toSafeTransportAttemptView),
        }
      : {}),
  };
}
