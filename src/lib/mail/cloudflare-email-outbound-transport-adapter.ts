import {
  CloudflareEmailProviderError,
  CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES,
  type CloudflareEmailAddress,
  type CloudflareEmailSendBinding,
  type CloudflareEmailSendResponse,
} from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import type {
  OutboundAttachmentByteReader,
  OutboundAttachmentStreamRef,
} from "@/lib/mail/outbound-attachment-retrieval";
import {
  CLOUDFLARE_EMAIL_OUTBOUND_PROVIDER_ID,
  isCloudflareOutboundProductionMode,
  OUTBOUND_TRANSPORT_DRY_RUN_MESSAGE_PREFIX,
  OUTBOUND_TRANSPORT_DRY_RUN_REQUEST_PREFIX,
  type MailOutboundTransportMode,
} from "@/lib/mail/outbound-transport-constants";
import type {
  MailTransportAdapter,
  MailTransportSubmitResult,
  NormalizedOutboundRecipient,
  NormalizedOutboundSubmission,
} from "@/lib/mail/transport/mail-transport-adapter";

export const CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES =
  CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES;

export type CloudflareEmailOutboundAttachmentPayload = {
  filename: string;
  mimeType: string;
  contentHash: string;
  sizeBytes: number;
  storageKey: string;
  content?: Uint8Array;
};

export type CloudflareEmailOutboundSendRequest = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  from: string | CloudflareEmailAddress;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: CloudflareEmailOutboundAttachmentPayload[];
};

export type CloudflareEmailOutboundTransportConfig = {
  transportMode?: MailOutboundTransportMode;
  /** @deprecated Prefer transportMode. */
  transportEnabled?: boolean;
  emailBinding?: CloudflareEmailSendBinding;
  attachmentReader?: OutboundAttachmentByteReader;
  resolveAttachmentRefs?: (
    submission: NormalizedOutboundSubmission,
  ) => Promise<OutboundAttachmentStreamRef[]>;
};

function resolveAdapterTransportMode(
  config: CloudflareEmailOutboundTransportConfig,
): MailOutboundTransportMode {
  if (config.transportMode) {
    return config.transportMode;
  }
  if (config.transportEnabled === true) {
    return "production";
  }
  if (config.transportEnabled === false) {
    return "dry_run";
  }
  return "disabled";
}

export type OutboundTransportCapture = {
  callCount: number;
  calls: Array<{
    submission: NormalizedOutboundSubmission;
    request: CloudflareEmailOutboundSendRequest;
    attachmentRefs: OutboundAttachmentStreamRef[];
  }>;
};

function formatRecipientAddress(recipient: NormalizedOutboundRecipient): string {
  if (recipient.displayName?.trim()) {
    return `${recipient.displayName.trim()} <${recipient.address}>`;
  }
  return recipient.address;
}

function groupRecipientAddresses(
  recipients: NormalizedOutboundRecipient[],
  type: string,
): string[] {
  return recipients
    .filter((recipient) => recipient.type === type)
    .map(formatRecipientAddress);
}

function formatFromAddress(
  fromAddress: string,
  fromDisplayName: string | null,
): string | CloudflareEmailAddress {
  if (fromDisplayName?.trim()) {
    return { email: fromAddress, name: fromDisplayName.trim() };
  }
  return fromAddress;
}

function appendSignatureText(
  bodyText: string | null,
  signatureBodyText: string | null,
): string | undefined {
  const parts = [bodyText?.trim(), signatureBodyText?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function appendSignatureHtml(
  bodyHtmlSanitized: string | null,
  signatureBodyHtmlSanitized: string | null,
): string | undefined {
  const parts = [
    bodyHtmlSanitized?.trim(),
    signatureBodyHtmlSanitized?.trim(),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("<br><br>") : undefined;
}

export function buildCloudflareEmailOutboundSendRequest(input: {
  submission: NormalizedOutboundSubmission;
  attachmentRefs: OutboundAttachmentStreamRef[];
  attachmentBytes?: Map<string, Uint8Array>;
}): CloudflareEmailOutboundSendRequest {
  const { submission, attachmentRefs, attachmentBytes } = input;
  const to = groupRecipientAddresses(submission.recipients, "to");
  const cc = groupRecipientAddresses(submission.recipients, "cc");
  const bcc = groupRecipientAddresses(submission.recipients, "bcc");

  const threadingHeaders: Record<string, string> = {};
  if (submission.inReplyTo) {
    threadingHeaders["In-Reply-To"] = submission.inReplyTo;
  }
  if (submission.referencesHeader) {
    threadingHeaders.References = submission.referencesHeader;
  }

  const request: CloudflareEmailOutboundSendRequest = {
    to,
    from: formatFromAddress(submission.fromAddress, submission.fromDisplayName),
    subject: submission.subject,
    text: appendSignatureText(
      submission.bodyText,
      submission.signatureBodyText,
    ),
    html: appendSignatureHtml(
      submission.bodyHtmlSanitized,
      submission.signatureBodyHtmlSanitized,
    ),
    ...(Object.keys(threadingHeaders).length > 0
      ? { headers: threadingHeaders }
      : {}),
  };

  if (cc.length > 0) {
    request.cc = cc;
  }
  if (bcc.length > 0) {
    request.bcc = bcc;
  }

  if (attachmentRefs.length > 0) {
    request.attachments = attachmentRefs.map((ref) => ({
      filename: ref.displayFilename,
      mimeType: ref.mimeType,
      contentHash: ref.contentHash,
      sizeBytes: ref.sizeBytes,
      storageKey: ref.storageKey,
      content: attachmentBytes?.get(ref.storageKey),
    }));
  }

  return request;
}

function parseAcceptedResponse(
  response: CloudflareEmailSendResponse,
): MailTransportSubmitResult {
  const messageId =
    typeof response.messageId === "string" ? response.messageId.trim() : "";
  if (messageId.length === 0) {
    throw new Error("Cloudflare outbound accepted response missing messageId");
  }
  return {
    outcome: "accepted",
    providerRequestId: messageId,
    providerMessageId: messageId,
  };
}

function mapProviderErrorCode(code: string): MailTransportSubmitResult | null {
  switch (code) {
    case "E_VALIDATION_ERROR":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.validation,
      };
    case "E_FIELD_MISSING":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.fieldMissing,
      };
    case "E_TOO_MANY_RECIPIENTS":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.tooManyRecipients,
      };
    case "E_TOO_MANY_ATTACHMENTS":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.tooManyAttachments,
      };
    case "E_SENDER_NOT_VERIFIED":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.senderNotVerified,
      };
    case "E_RECIPIENT_NOT_ALLOWED":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.recipientNotAllowed,
      };
    case "E_RECIPIENT_SUPPRESSED":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.recipientSuppressed,
      };
    case "E_SENDER_DOMAIN_NOT_AVAILABLE":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.senderDomainUnavailable,
      };
    case "E_CONTENT_TOO_LARGE":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.contentTooLarge,
      };
    case "E_RATE_LIMIT_EXCEEDED":
      return {
        outcome: "temporary_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.rateLimitExceeded,
      };
    case "E_DAILY_LIMIT_EXCEEDED":
      return {
        outcome: "temporary_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.dailyLimitExceeded,
      };
    case "E_INTERNAL_SERVER_ERROR":
      return {
        outcome: "temporary_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.internalServerError,
      };
    case "E_DELIVERY_FAILED":
      return {
        outcome: "temporary_failure",
        errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.deliveryFailed,
      };
    default:
      return null;
  }
}

function mapThrownError(error: unknown): MailTransportSubmitResult {
  if (typeof error !== "object" || error === null) {
    throw error;
  }
  const code =
    "code" in error && typeof error.code === "string" ? error.code : undefined;
  if (!code) {
    throw error;
  }
  return (
    mapProviderErrorCode(code) ?? {
      outcome: "ambiguous",
      errorCode: CLOUDFLARE_EMAIL_OUTBOUND_ERROR_CODES.dispatchUncertain,
      errorMessage: code,
    }
  );
}

function buildDryRunAcceptedResult(
  submission: NormalizedOutboundSubmission,
): MailTransportSubmitResult {
  const providerMessageId = `<dry-run-${submission.transportAttemptId}@echfronthk.com>`;
  return {
    outcome: "accepted",
    providerRequestId: `${OUTBOUND_TRANSPORT_DRY_RUN_REQUEST_PREFIX}${submission.transportAttemptId}`,
    providerMessageId,
  };
}

async function loadAttachmentBytes(
  refs: OutboundAttachmentStreamRef[],
  reader: OutboundAttachmentByteReader,
): Promise<Map<string, Uint8Array>> {
  const bytes = new Map<string, Uint8Array>();
  for (const ref of refs) {
    bytes.set(ref.storageKey, await reader.read(ref));
  }
  return bytes;
}

async function defaultAttachmentRefs(
  submission: NormalizedOutboundSubmission,
): Promise<OutboundAttachmentStreamRef[]> {
  return submission.attachments.map((attachment) => ({
    revisionAttachmentId: attachment.revisionAttachmentId,
    storedFileId: attachment.storedFileId,
    contentHash: attachment.contentHash,
    displayFilename: attachment.displayFilename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    storageProvider: "r2",
    storageBucket: "crm-attachments",
    storageKey: `mail/outbound-attachments/${attachment.storedFileId}`,
  }));
}

/**
 * Cloudflare Email Sending adapter for approved business-mail send operations.
 * Default mode is disabled — preflight blocks dispatch before adapter invoke.
 */
export function createCloudflareEmailOutboundTransport(
  config: CloudflareEmailOutboundTransportConfig,
): MailTransportAdapter & { readonly capture: OutboundTransportCapture } {
  const transportMode = resolveAdapterTransportMode(config);
  const capture: OutboundTransportCapture = {
    callCount: 0,
    calls: [],
  };

  return {
    providerId: CLOUDFLARE_EMAIL_OUTBOUND_PROVIDER_ID,
    capture,

    async submitOutbound(
      submission: NormalizedOutboundSubmission,
    ): Promise<MailTransportSubmitResult> {
      capture.callCount += 1;

      if (transportMode === "disabled" || transportMode === "proof_only") {
        throw new Error(
          `Outbound transport mode "${transportMode}" does not permit provider submission`,
        );
      }

      const attachmentRefs = config.resolveAttachmentRefs
        ? await config.resolveAttachmentRefs(submission)
        : await defaultAttachmentRefs(submission);

      let attachmentBytes: Map<string, Uint8Array> | undefined;
      if (isCloudflareOutboundProductionMode(transportMode)) {
        if (!config.emailBinding) {
          throw new Error(
            "EMAIL binding is required when outbound transport mode is production",
          );
        }
        if (!config.attachmentReader) {
          throw new Error(
            "Attachment byte reader is required when outbound transport mode is production",
          );
        }
        attachmentBytes = await loadAttachmentBytes(
          attachmentRefs,
          config.attachmentReader,
        );
      }

      const request = buildCloudflareEmailOutboundSendRequest({
        submission,
        attachmentRefs,
        attachmentBytes,
      });

      capture.calls.push({
        submission: structuredClone(submission),
        request: structuredClone(request),
        attachmentRefs: structuredClone(attachmentRefs),
      });

      if (transportMode === "dry_run") {
        return buildDryRunAcceptedResult(submission);
      }

      try {
        const providerRequest = {
          to: request.to[0] ?? "",
          from: request.from,
          subject: request.subject,
          text: request.text,
          html: request.html,
        };
        const response = await config.emailBinding!.send(providerRequest);
        return parseAcceptedResponse(response);
      } catch (error) {
        if (error instanceof CloudflareEmailProviderError) {
          return mapProviderErrorCode(error.code) ?? mapThrownError(error);
        }
        return mapThrownError(error);
      }
    },
  };
}

export function buildCloudflareEmailOutboundSendRequestForTest(
  submission: NormalizedOutboundSubmission,
  attachmentRefs: OutboundAttachmentStreamRef[] = [],
): CloudflareEmailOutboundSendRequest {
  return buildCloudflareEmailOutboundSendRequest({
    submission,
    attachmentRefs,
  });
}
