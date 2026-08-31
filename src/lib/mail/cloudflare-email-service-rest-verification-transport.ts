import {
  CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES,
  CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
  CLOUDFLARE_EMAIL_NOTIFICATION_FROM_DISPLAY_NAME,
  type CloudflareEmailSendDispatchResult,
} from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import {
  classifySafeError,
  logVerificationDeliveryStage,
  type VerificationDeliveryObservationContext,
} from "@/lib/mail/notification-verification-delivery-observability";

/** mail-jobs-only secret — never commit, never log. */
export const CLOUDFLARE_EMAIL_SENDING_API_TOKEN_ENV =
  "CLOUDFLARE_EMAIL_SENDING_API_TOKEN" as const;

/** mail-jobs-only non-secret account identifier for REST dispatch. */
export const CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID_ENV =
  "CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID" as const;

/**
 * Bounded REST dispatch for verification OTP — must stay well below the mail-jobs
 * 25s soft tick budget and far below the 15-minute processing lease.
 */
export const NOTIFICATION_VERIFICATION_EMAIL_REST_SEND_TIMEOUT_MS =
  20_000 as const;

export const CLOUDFLARE_EMAIL_SERVICE_REST_ERROR_CODES = {
  authConfig: "cloudflare_email_rest_auth_config_error",
  validation: "cloudflare_email_rest_validation_error",
  rateLimitExceeded: "cloudflare_email_rest_rate_limit_exceeded",
  serverError: "cloudflare_email_rest_server_error",
  transportNotConfigured: "cloudflare_email_rest_transport_not_configured",
} as const;

export type CloudflareEmailServiceRestVerificationTransportConfig = {
  accountId: string;
  apiToken: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

export type CloudflareEmailServiceRestVerificationSendInput = {
  to: string;
  subject: string;
  text: string;
  observability?: VerificationDeliveryObservationContext;
};

type CloudflareEmailServiceRestSendResultPayload = {
  message_id?: string;
  delivered?: string[];
  queued?: string[];
  permanent_bounces?: string[];
};

type CloudflareEmailServiceRestSendResponse = {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: CloudflareEmailServiceRestSendResultPayload | null;
};

function readNonEmptyEnvValue(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const value = env[name];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

export function resolveCloudflareEmailServiceRestVerificationTransportConfig(
  env: Record<string, string | undefined>,
): CloudflareEmailServiceRestVerificationTransportConfig {
  const accountId = readNonEmptyEnvValue(env, CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID_ENV);
  const apiToken = readNonEmptyEnvValue(env, CLOUDFLARE_EMAIL_SENDING_API_TOKEN_ENV);

  if (!accountId || !apiToken) {
    throw new Error(
      "Cloudflare Email Service REST verification transport is not configured",
    );
  }

  return { accountId, apiToken };
}

export function buildCloudflareEmailServiceRestSendUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`;
}

export function buildCloudflareEmailServiceRestVerificationRequestBody(
  input: CloudflareEmailServiceRestVerificationSendInput,
): Record<string, unknown> {
  return {
    to: input.to,
    from: {
      address: CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
      name: CLOUDFLARE_EMAIL_NOTIFICATION_FROM_DISPLAY_NAME,
    },
    subject: input.subject,
    text: input.text,
  };
}

function normalizeRecipient(value: string): string {
  return value.trim().toLowerCase();
}

function recipientInList(recipient: string, values: string[] | undefined): boolean {
  if (!values || values.length === 0) {
    return false;
  }
  const normalized = normalizeRecipient(recipient);
  return values.some((entry) => normalizeRecipient(entry) === normalized);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function parseCloudflareEmailServiceRestSendResponse(
  payload: unknown,
): CloudflareEmailServiceRestSendResponse | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  return payload as CloudflareEmailServiceRestSendResponse;
}

function classifyHttpStatus(status: number): CloudflareEmailSendDispatchResult {
  if (status === 401 || status === 403) {
    return {
      outcome: "permanent_failure",
      errorCode: CLOUDFLARE_EMAIL_SERVICE_REST_ERROR_CODES.authConfig,
    };
  }
  if (status === 400) {
    return {
      outcome: "permanent_failure",
      errorCode: CLOUDFLARE_EMAIL_SERVICE_REST_ERROR_CODES.validation,
    };
  }
  if (status === 429) {
    return {
      outcome: "temporary_failure",
      errorCode: CLOUDFLARE_EMAIL_SERVICE_REST_ERROR_CODES.rateLimitExceeded,
    };
  }
  if (status >= 500) {
    return { outcome: "ambiguous" };
  }
  return { outcome: "ambiguous" };
}

function classifySuccessfulRestPayload(
  recipient: string,
  payload: CloudflareEmailServiceRestSendResponse,
): CloudflareEmailSendDispatchResult {
  if (payload.success !== true) {
    const firstError = payload.errors?.[0];
    if (firstError?.message) {
      return {
        outcome: "permanent_failure",
        errorCode: CLOUDFLARE_EMAIL_SERVICE_REST_ERROR_CODES.validation,
        errorMessage: firstError.message,
      };
    }
    return { outcome: "ambiguous" };
  }

  const messageId =
    typeof payload.result?.message_id === "string"
      ? payload.result.message_id.trim()
      : "";
  if (messageId.length === 0) {
    return { outcome: "ambiguous" };
  }

  if (recipientInList(recipient, payload.result?.permanent_bounces)) {
    return {
      outcome: "permanent_failure",
      errorCode: CLOUDFLARE_EMAIL_NOTIFICATION_ERROR_CODES.recipientSuppressed,
    };
  }

  if (
    recipientInList(recipient, payload.result?.delivered) ||
    recipientInList(recipient, payload.result?.queued)
  ) {
    return {
      outcome: "accepted",
      providerRequestId: messageId,
    };
  }

  return { outcome: "ambiguous" };
}

/**
 * Bounded Cloudflare Email Service REST dispatch for verification OTP delivery.
 * Abort/timeouts are ambiguous — email may already have been accepted upstream.
 */
export async function dispatchCloudflareEmailServiceRestVerificationSend(
  config: CloudflareEmailServiceRestVerificationTransportConfig,
  input: CloudflareEmailServiceRestVerificationSendInput,
): Promise<CloudflareEmailSendDispatchResult> {
  const accountId = config.accountId.trim();
  const apiToken = config.apiToken.trim();
  if (accountId.length === 0 || apiToken.length === 0) {
    return {
      outcome: "permanent_failure",
      errorCode: CLOUDFLARE_EMAIL_SERVICE_REST_ERROR_CODES.transportNotConfigured,
    };
  }

  const timeoutMs =
    config.timeoutMs ?? NOTIFICATION_VERIFICATION_EMAIL_REST_SEND_TIMEOUT_MS;
  const fetchFn = config.fetchFn ?? fetch;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const fetchStartedAt = Date.now();
  if (input.observability) {
    logVerificationDeliveryStage(
      input.observability,
      "REST_FETCH_STARTED",
    );
  }

  try {
    const response = await fetchFn(
      buildCloudflareEmailServiceRestSendUrl(accountId),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildCloudflareEmailServiceRestVerificationRequestBody(input),
        ),
        signal: controller.signal,
      },
    );
    if (input.observability) {
      logVerificationDeliveryStage(
        input.observability,
        "REST_FETCH_RETURNED",
        {
          httpStatus: response.status,
          httpOk: response.ok,
          elapsedMs: Date.now() - fetchStartedAt,
        },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (input.observability) {
        logVerificationDeliveryStage(
          input.observability,
          "REST_RESPONSE_CLASSIFIED",
          {
            classification: "ambiguous",
          },
        );
      }
      return { outcome: "ambiguous" };
    }

    const parsed = parseCloudflareEmailServiceRestSendResponse(payload);
    if (!parsed) {
      if (input.observability) {
        logVerificationDeliveryStage(
          input.observability,
          "REST_RESPONSE_CLASSIFIED",
          {
            classification: "ambiguous",
          },
        );
      }
      return { outcome: "ambiguous" };
    }

    let result: CloudflareEmailSendDispatchResult;
    if (!response.ok) {
      const statusResult = classifyHttpStatus(response.status);
      if (statusResult.outcome !== "ambiguous") {
        result = statusResult;
      } else {
        result = classifySuccessfulRestPayload(input.to, parsed);
      }
    } else {
      result = classifySuccessfulRestPayload(input.to, parsed);
    }
    if (input.observability) {
      logVerificationDeliveryStage(
        input.observability,
        "REST_RESPONSE_CLASSIFIED",
        { classification: result.outcome },
      );
    }
    return result;
  } catch (error) {
    if (isAbortError(error)) {
      if (input.observability) {
        logVerificationDeliveryStage(
          input.observability,
          "REST_FETCH_ABORTED",
          { elapsedMs: Date.now() - fetchStartedAt },
        );
        logVerificationDeliveryStage(
          input.observability,
          "REST_RESPONSE_CLASSIFIED",
          { classification: "ambiguous" },
        );
      }
      return { outcome: "ambiguous" };
    }
    if (input.observability) {
      logVerificationDeliveryStage(
        input.observability,
        "REST_RESPONSE_CLASSIFIED",
        {
          classification: "ambiguous",
          errorCategory: classifySafeError(error),
        },
      );
    }
    return { outcome: "ambiguous" };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
