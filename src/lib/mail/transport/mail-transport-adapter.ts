/**
 * Provider-neutral outbound transport boundary (Phase 2C.7).
 *
 * Operates on structured normalized semantics — NOT final MIME bytes.
 * Real provider adapters are injected at service/test boundaries only.
 */
import type { OutboundDispatchDiagnostic } from "@/lib/mail/outbound-dispatch-diagnostics";

export type NormalizedOutboundAttachment = {
  revisionAttachmentId: string;
  storedFileId: string;
  contentHash: string;
  displayFilename: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  deliveryMode: string;
  secureExpiryDays: number | null;
};

export type NormalizedOutboundSignatureAsset = {
  assetRef: string;
  storedFileId: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
};

export type NormalizedOutboundRecipient = {
  type: string;
  address: string;
  displayName: string | null;
};

export type NormalizedOutboundSubmission = {
  sendOperationId: string;
  transportAttemptId: string;
  outboundRevisionId: string;
  /** Optional for compatibility with existing injected test submissions. */
  authorizationMode?: "staff_approved" | "admin_direct";
  rfcMessageId: string;
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string;
  bodyText: string | null;
  bodyHtmlSanitized: string | null;
  signatureBodyText: string | null;
  signatureBodyHtmlSanitized: string | null;
  signatureAssets: NormalizedOutboundSignatureAsset[];
  recipients: NormalizedOutboundRecipient[];
  attachments: NormalizedOutboundAttachment[];
  inReplyTo: string | null;
  referencesHeader: string | null;
};

export type MailTransportSubmitAccepted = {
  outcome: "accepted";
  providerRequestId: string;
  providerMessageId: string;
  diagnostic?: OutboundDispatchDiagnostic;
};

export type MailTransportSubmitTemporaryFailure = {
  outcome: "temporary_failure";
  errorCode?: string;
  errorMessage?: string;
  retryAfterAt?: string;
  diagnostic?: OutboundDispatchDiagnostic;
};

export type MailTransportSubmitPermanentFailure = {
  outcome: "permanent_failure";
  errorCode?: string;
  errorMessage?: string;
  diagnostic?: OutboundDispatchDiagnostic;
};

export type MailTransportSubmitAmbiguous = {
  outcome: "ambiguous";
  errorCode?: string;
  errorMessage?: string;
  diagnostic?: OutboundDispatchDiagnostic;
};

export type MailTransportSubmitResult =
  | MailTransportSubmitAccepted
  | MailTransportSubmitTemporaryFailure
  | MailTransportSubmitPermanentFailure
  | MailTransportSubmitAmbiguous;

export interface MailTransportAdapter {
  readonly providerId: string;
  submitOutbound(
    input: NormalizedOutboundSubmission,
  ): Promise<MailTransportSubmitResult>;
}
