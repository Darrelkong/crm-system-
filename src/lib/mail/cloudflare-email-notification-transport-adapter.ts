import type { RenderedNotificationPayload } from "@/lib/mail/notification-privacy-renderer";
import type {
  NotificationTransportAdapter,
  NotificationTransportInput,
  NotificationTransportResult,
} from "@/lib/mail/notification-transport-adapter";

/** Frozen V1 provider identifier for notification attempt provenance. */
export const CLOUDFLARE_EMAIL_NOTIFICATION_PROVIDER_ID =
  "cloudflare-email-sending" as const;

/** Infrastructure From — not a CRM Sender Identity. Domain onboarding is a separate gate. */
export const CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS =
  "notifications@send.echfronthk.com" as const;

export const CLOUDFLARE_EMAIL_NOTIFICATION_FROM_DISPLAY_NAME =
  "ECHFRONT CRM Mail" as const;

/** Generic server-owned subject — no customer/mail content. */
export const CLOUDFLARE_EMAIL_NOTIFICATION_SUBJECT =
  "ECHFRONT CRM Mail 通知" as const;

/**
 * Future business-mail attachment policy (NOT implemented in notification adapter):
 * - ordinary external recipient: total message size <= 5 MiB
 * - verified destination: up to 25 MiB (Cloudflare limit)
 * - CRM 100MB product requirement: Secure File workflow, not MIME attachment
 */
export const CLOUDFLARE_EMAIL_ORDINARY_EXTERNAL_MESSAGE_LIMIT_BYTES =
  5 * 1024 * 1024;

export type CloudflareEmailAddress = {
  email: string;
  name?: string;
};

export type CloudflareEmailSendRequest = {
  to: string;
  from: string | CloudflareEmailAddress;
  subject: string;
  text?: string;
  html?: string;
};

export type CloudflareEmailSendResponse = {
  messageId: string;
};

/** Minimal SendEmail binding surface — injected at Worker wiring boundary only. */
export interface CloudflareEmailSendBinding {
  send(message: CloudflareEmailSendRequest): Promise<CloudflareEmailSendResponse>;
}

export type CloudflareEmailNotificationTransportConfig = {
  emailBinding: CloudflareEmailSendBinding;
  fromAddress?: string;
};

export const CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES = {
  validation: "cloudflare_email_validation_error",
  fieldMissing: "cloudflare_email_field_missing",
  tooManyRecipients: "cloudflare_email_too_many_recipients",
  tooManyAttachments: "cloudflare_email_too_many_attachments",
  senderNotVerified: "cloudflare_email_sender_not_verified",
  recipientNotAllowed: "cloudflare_email_recipient_not_allowed",
  recipientSuppressed: "cloudflare_email_recipient_suppressed",
  senderDomainUnavailable: "cloudflare_email_sender_domain_unavailable",
  contentTooLarge: "cloudflare_email_content_too_large",
  rateLimitExceeded: "cloudflare_email_rate_limit_exceeded",
  dailyLimitExceeded: "cloudflare_email_daily_limit_exceeded",
  deliveryFailed: "cloudflare_email_delivery_failed",
  internalServerError: "cloudflare_email_internal_server_error",
  dispatchUncertain: "cloudflare_email_dispatch_uncertain",
  headerNotAllowed: "cloudflare_email_header_not_allowed",
  headerUseApiField: "cloudflare_email_header_use_api_field",
  headerValueInvalid: "cloudflare_email_header_value_invalid",
  headerValueTooLong: "cloudflare_email_header_value_too_long",
  headerNameInvalid: "cloudflare_email_header_name_invalid",
  headersTooLarge: "cloudflare_email_headers_too_large",
  headersTooMany: "cloudflare_email_headers_too_many",
} as const;

type CloudflareEmailProviderErrorCode =
  | "E_VALIDATION_ERROR"
  | "E_FIELD_MISSING"
  | "E_TOO_MANY_RECIPIENTS"
  | "E_TOO_MANY_ATTACHMENTS"
  | "E_SENDER_NOT_VERIFIED"
  | "E_RECIPIENT_NOT_ALLOWED"
  | "E_RECIPIENT_SUPPRESSED"
  | "E_SENDER_DOMAIN_NOT_AVAILABLE"
  | "E_CONTENT_TOO_LARGE"
  | "E_RATE_LIMIT_EXCEEDED"
  | "E_DAILY_LIMIT_EXCEEDED"
  | "E_DELIVERY_FAILED"
  | "E_INTERNAL_SERVER_ERROR"
  | "E_HEADER_NOT_ALLOWED"
  | "E_HEADER_USE_API_FIELD"
  | "E_HEADER_VALUE_INVALID"
  | "E_HEADER_VALUE_TOO_LONG"
  | "E_HEADER_NAME_INVALID"
  | "E_HEADERS_TOO_LARGE"
  | "E_HEADERS_TOO_MANY";

function formatFromAddress(fromAddress: string): CloudflareEmailAddress {
  return {
    email: fromAddress,
    name: CLOUDFLARE_EMAIL_NOTIFICATION_FROM_DISPLAY_NAME,
  };
}

function buildSendRequest(
  input: NotificationTransportInput,
  fromAddress: string,
): CloudflareEmailSendRequest {
  return {
    to: input.targetEmail,
    from: formatFromAddress(fromAddress),
    subject: CLOUDFLARE_EMAIL_NOTIFICATION_SUBJECT,
    text: input.payload.bodyText,
  };
}

function parseAcceptedResponse(
  response: CloudflareEmailSendResponse,
): NotificationTransportResult {
  const messageId =
    typeof response.messageId === "string" ? response.messageId.trim() : "";
  if (messageId.length === 0) {
    return { outcome: "ambiguous" };
  }
  return {
    outcome: "accepted",
    providerRequestId: messageId,
  };
}

function mapProviderErrorCode(
  code: string,
): NotificationTransportResult | null {
  switch (code as CloudflareEmailProviderErrorCode) {
    case "E_VALIDATION_ERROR":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.validation,
      };
    case "E_FIELD_MISSING":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.fieldMissing,
      };
    case "E_TOO_MANY_RECIPIENTS":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.tooManyRecipients,
      };
    case "E_TOO_MANY_ATTACHMENTS":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.tooManyAttachments,
      };
    case "E_SENDER_NOT_VERIFIED":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.senderNotVerified,
      };
    case "E_RECIPIENT_NOT_ALLOWED":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.recipientNotAllowed,
      };
    case "E_RECIPIENT_SUPPRESSED":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.recipientSuppressed,
      };
    case "E_SENDER_DOMAIN_NOT_AVAILABLE":
      return {
        outcome: "permanent_failure",
        errorCode:
          CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.senderDomainUnavailable,
      };
    case "E_CONTENT_TOO_LARGE":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.contentTooLarge,
      };
    case "E_HEADER_NOT_ALLOWED":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.headerNotAllowed,
      };
    case "E_HEADER_USE_API_FIELD":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.headerUseApiField,
      };
    case "E_HEADER_VALUE_INVALID":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.headerValueInvalid,
      };
    case "E_HEADER_VALUE_TOO_LONG":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.headerValueTooLong,
      };
    case "E_HEADER_NAME_INVALID":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.headerNameInvalid,
      };
    case "E_HEADERS_TOO_LARGE":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.headersTooLarge,
      };
    case "E_HEADERS_TOO_MANY":
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.headersTooMany,
      };
    case "E_RATE_LIMIT_EXCEEDED":
      return {
        outcome: "temporary_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.rateLimitExceeded,
      };
    case "E_DAILY_LIMIT_EXCEEDED":
      return {
        outcome: "temporary_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.dailyLimitExceeded,
      };
    case "E_INTERNAL_SERVER_ERROR":
      return {
        outcome: "temporary_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.internalServerError,
      };
    case "E_DELIVERY_FAILED":
      // Cloudflare docs: retry with exponential backoff — treat as retryable.
      return {
        outcome: "temporary_failure",
        errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.deliveryFailed,
      };
    default:
      return null;
  }
}

function mapThrownError(error: unknown): NotificationTransportResult {
  if (typeof error !== "object" || error === null) {
    return { outcome: "ambiguous" };
  }

  const code =
    "code" in error && typeof error.code === "string" ? error.code : undefined;
  if (!code) {
    return { outcome: "ambiguous" };
  }

  return mapProviderErrorCode(code) ?? { outcome: "ambiguous" };
}

/**
 * Cloudflare Email Sending notification transport for private staff alerts only.
 * Uses native Workers send_email binding — no REST API token, no third-party SDK.
 * Not wired in production Mail Jobs Worker until a future enablement gate.
 */
export function createCloudflareEmailNotificationTransport(
  config: CloudflareEmailNotificationTransportConfig,
): NotificationTransportAdapter {
  const fromAddress =
    config.fromAddress ?? CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS;

  return {
    providerId: CLOUDFLARE_EMAIL_NOTIFICATION_PROVIDER_ID,

    async send(
      input: NotificationTransportInput,
    ): Promise<NotificationTransportResult> {
      try {
        const response = await config.emailBinding.send(
          buildSendRequest(input, fromAddress),
        );
        return parseAcceptedResponse(response);
      } catch (error) {
        return mapThrownError(error);
      }
    },
  };
}

/** Test helper — exposes frozen request body shape without a real binding. */
export function buildCloudflareEmailNotificationSendRequestForTest(
  input: NotificationTransportInput,
  fromAddress: string = CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
): CloudflareEmailSendRequest {
  return buildSendRequest(input, fromAddress);
}

export class CloudflareEmailProviderError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CloudflareEmailProviderError";
  }
}

/**
 * Bounded wait for verification EMAIL.send — must stay well below the mail-jobs
 * 25s soft tick budget and far below the 15-minute processing lease.
 */
export const NOTIFICATION_VERIFICATION_EMAIL_SEND_TIMEOUT_MS = 20_000 as const;

export type CloudflareEmailSendDispatchResult =
  | {
      outcome: "accepted";
      providerRequestId: string;
    }
  | {
      outcome: "temporary_failure";
      errorCode: string;
      errorMessage?: string;
    }
  | {
      outcome: "permanent_failure";
      errorCode: string;
      errorMessage?: string;
    }
  | {
      outcome: "ambiguous";
    };

function mapTransportResultToDispatchResult(
  result: NotificationTransportResult,
): CloudflareEmailSendDispatchResult {
  if (result.outcome === "accepted") {
    const providerRequestId = result.providerRequestId?.trim();
    if (!providerRequestId) {
      return { outcome: "ambiguous" };
    }
    return {
      outcome: "accepted",
      providerRequestId,
    };
  }
  if (result.outcome === "temporary_failure") {
    return {
      outcome: "temporary_failure",
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    };
  }
  if (result.outcome === "permanent_failure") {
    return {
      outcome: "permanent_failure",
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    };
  }
  return { outcome: "ambiguous" };
}

/**
 * Bounded Cloudflare send_email dispatch for verification delivery.
 * Never blocks indefinitely; ambiguous outcomes must not be auto-retried.
 */
export async function dispatchCloudflareEmailSendWithTimeout(
  emailBinding: CloudflareEmailSendBinding,
  request: CloudflareEmailSendRequest,
  options?: { timeoutMs?: number },
): Promise<CloudflareEmailSendDispatchResult> {
  const timeoutMs =
    options?.timeoutMs ?? NOTIFICATION_VERIFICATION_EMAIL_SEND_TIMEOUT_MS;

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });

  const sendPromise = emailBinding
    .send(request)
    .then(
      (response) => ({ kind: "success" as const, response }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );

  const raced = await Promise.race([sendPromise, timeoutPromise]);
  if (timeoutHandle !== undefined) {
    clearTimeout(timeoutHandle);
  }

  if (raced.kind === "timeout") {
    return { outcome: "ambiguous" };
  }
  if (raced.kind === "error") {
    return mapTransportResultToDispatchResult(mapThrownError(raced.error));
  }
  return mapTransportResultToDispatchResult(parseAcceptedResponse(raced.response));
}
