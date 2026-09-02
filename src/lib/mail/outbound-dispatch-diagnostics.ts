import type {
  MailTransportSubmitResult,
  NormalizedOutboundSubmission,
} from "@/lib/mail/transport/mail-transport-adapter";

export const OUTBOUND_DISPATCH_DIAGNOSTIC_VERSION = 1 as const;
export const OUTBOUND_DISPATCH_DIAGNOSTIC_PREFIX =
  "outbound-dispatch-diagnostic:v1:" as const;
export const OUTBOUND_DISPATCH_DIAGNOSTIC_MAX_MESSAGE_LENGTH = 240 as const;
export const OUTBOUND_DISPATCH_DIAGNOSTIC_MAX_LENGTH = 4_096 as const;

export type OutboundDispatchFailureClass =
  | "http_rejection"
  | "provider_5xx"
  | "provider_internal_error"
  | "timeout"
  | "abort"
  | "network_reset"
  | "network_error"
  | "response_parse"
  | "unknown_provider_error"
  | "local_preflight"
  | null;

export type OutboundProviderAcceptance =
  | "confirmed"
  | "not_confirmed"
  | "unknown";

export type OutboundDispatchDiagnostic = {
  version: typeof OUTBOUND_DISPATCH_DIAGNOSTIC_VERSION;
  sendOperationId: string;
  attemptId: string;
  authorizationMode: string | null;
  adapter: string;
  providerResponseReceived: boolean;
  providerAcceptance: OutboundProviderAcceptance;
  providerHttpStatus: number | null;
  providerErrorCategory: string | null;
  providerErrorCode: string | null;
  providerCorrelationId: string | null;
  responseContentType: string | null;
  safeProviderMessage: string | null;
  failureClass: OutboundDispatchFailureClass;
  attachmentCount: number;
  attachmentBytes: number;
  mimeEnvelopeSizeBytes: number | null;
  elapsedDispatchMs: number;
};

type DiagnosticSubmission = Pick<
  NormalizedOutboundSubmission,
  "sendOperationId" | "transportAttemptId" | "authorizationMode" | "attachments"
>;

type DiagnosticProviderMetadata = {
  providerResponseReceived?: boolean;
  providerAcceptance?: OutboundProviderAcceptance;
  providerHttpStatus?: number | null;
  providerErrorCategory?: string | null;
  providerErrorCode?: string | null;
  providerCorrelationId?: string | null;
  responseContentType?: string | null;
  safeProviderMessage?: string | null;
  failureClass?: OutboundDispatchFailureClass;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function boundedSafeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (
    /(authorization|bearer|api[_ -]?token|access[_ -]?token|secret|password|credential|otp|message\s*body|attachment\s*(?:bytes|content)|mime\s*body)/i.test(
      trimmed,
    )
  ) {
    return "Provider error details redacted";
  }
  return trimmed
    .replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      "[redacted-email]",
    )
    .slice(0, OUTBOUND_DISPATCH_DIAGNOSTIC_MAX_MESSAGE_LENGTH);
}

function boundedProviderCode(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const normalized = value.trim();
  if (
    normalized.length > 96 ||
    !/^[A-Za-z0-9._:/+-]+$/.test(normalized) ||
    /(token|secret|password|credential|authorization|otp)/i.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function boundedHttpStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function boundedNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function attachmentBytes(submission: DiagnosticSubmission): number {
  return submission.attachments.reduce(
    (total, attachment) => total + Math.max(0, attachment.sizeBytes),
    0,
  );
}

export function normalizeOutboundDispatchDiagnostic(input: {
  submission: DiagnosticSubmission;
  provider: string;
  elapsedDispatchMs: number;
  diagnostic?: Partial<OutboundDispatchDiagnostic> | null;
  metadata?: DiagnosticProviderMetadata;
}): OutboundDispatchDiagnostic {
  const diagnostic = input.diagnostic ?? {};
  const metadata = input.metadata ?? {};
  const providerHttpStatus = boundedHttpStatus(
    metadata.providerHttpStatus ?? diagnostic.providerHttpStatus,
  );
  const providerResponseReceived =
    metadata.providerResponseReceived ??
    diagnostic.providerResponseReceived ??
    false;
  const providerAcceptance =
    metadata.providerAcceptance ??
    diagnostic.providerAcceptance ??
    "unknown";

  return {
    version: OUTBOUND_DISPATCH_DIAGNOSTIC_VERSION,
    sendOperationId: input.submission.sendOperationId,
    attemptId: input.submission.transportAttemptId,
    authorizationMode: boundedProviderCode(
      input.submission.authorizationMode ?? diagnostic.authorizationMode,
    ),
    adapter: boundedProviderCode(input.provider) ?? "unknown-adapter",
    providerResponseReceived,
    providerAcceptance,
    providerHttpStatus,
    providerErrorCategory: boundedProviderCode(
      metadata.providerErrorCategory ?? diagnostic.providerErrorCategory,
    ),
    providerErrorCode: boundedProviderCode(
      metadata.providerErrorCode ?? diagnostic.providerErrorCode,
    ),
    providerCorrelationId: boundedProviderCode(
      metadata.providerCorrelationId ?? diagnostic.providerCorrelationId,
    ),
    responseContentType: boundedProviderCode(
      metadata.responseContentType ?? diagnostic.responseContentType,
    ),
    safeProviderMessage: boundedSafeText(
      metadata.safeProviderMessage ?? diagnostic.safeProviderMessage,
    ),
    failureClass:
      metadata.failureClass !== undefined
        ? metadata.failureClass
        : diagnostic.failureClass ?? null,
    attachmentCount: input.submission.attachments.length,
    attachmentBytes: attachmentBytes(input.submission),
    mimeEnvelopeSizeBytes: null,
    elapsedDispatchMs: boundedNonNegativeInteger(input.elapsedDispatchMs),
  };
}

export function buildOutboundDispatchDiagnostic(
  input: {
    submission: DiagnosticSubmission;
    provider: string;
    elapsedDispatchMs: number;
  } & DiagnosticProviderMetadata,
): OutboundDispatchDiagnostic {
  return normalizeOutboundDispatchDiagnostic({
    submission: input.submission,
    provider: input.provider,
    elapsedDispatchMs: input.elapsedDispatchMs,
    metadata: input,
  });
}

export function classifyOutboundProviderError(
  error: unknown,
): {
  failureClass: Exclude<OutboundDispatchFailureClass, null>;
  providerHttpStatus: number | null;
  providerErrorCategory: string | null;
  providerErrorCode: string | null;
  providerCorrelationId: string | null;
  responseContentType: string | null;
  safeProviderMessage: string | null;
} {
  const record = asRecord(error);
  const name = typeof record?.name === "string" ? record.name : "";
  const code = typeof record?.code === "string" ? record.code : null;
  const status = boundedHttpStatus(record?.status ?? record?.statusCode);
  const failureClass =
    status !== null && status >= 400 && status < 500
      ? "http_rejection"
      : status !== null && status >= 500
        ? "provider_5xx"
        : name === "TimeoutError" || code === "ETIMEDOUT"
          ? "timeout"
          : name === "AbortError" || code === "ABORT_ERR"
            ? "abort"
            : code === "ECONNRESET"
              ? "network_reset"
              : code === "ECONNREFUSED" ||
                  code === "ENOTFOUND" ||
                  code === "EHOSTUNREACH"
                ? "network_error"
                : code === "E_INTERNAL_SERVER_ERROR"
                  ? "provider_internal_error"
                  : "unknown_provider_error";

  return {
    failureClass,
    providerHttpStatus: status,
    providerErrorCategory: boundedProviderCode(
      record?.category ?? record?.type ?? null,
    ),
    providerErrorCode: boundedProviderCode(code),
    providerCorrelationId: boundedProviderCode(
      record?.requestId ?? record?.rayId ?? record?.correlationId ?? null,
    ),
    responseContentType: boundedProviderCode(
      record?.responseContentType ?? null,
    ),
    safeProviderMessage: boundedSafeText(
      record?.message ?? (error instanceof Error ? error.message : null),
    ),
  };
}

export function buildOutboundDispatchDiagnosticFromResult(input: {
  submission: DiagnosticSubmission;
  provider: string;
  result: MailTransportSubmitResult;
  elapsedDispatchMs: number;
}): OutboundDispatchDiagnostic {
  const resultDiagnostic = "diagnostic" in input.result ? input.result.diagnostic : undefined;
  const providerAcceptance =
    input.result.outcome === "accepted"
      ? "confirmed"
      : input.result.outcome === "permanent_failure"
        ? "not_confirmed"
        : "unknown";
  const resultErrorCode =
    "errorCode" in input.result ? input.result.errorCode : undefined;
  const resultErrorMessage =
    "errorMessage" in input.result ? input.result.errorMessage : undefined;

  return normalizeOutboundDispatchDiagnostic({
    submission: input.submission,
    provider: input.provider,
    elapsedDispatchMs: input.elapsedDispatchMs,
    diagnostic: resultDiagnostic,
    metadata: {
      providerResponseReceived:
        resultDiagnostic?.providerResponseReceived ??
        input.result.outcome === "accepted",
      providerAcceptance,
      providerErrorCode:
        resultDiagnostic?.providerErrorCode ?? resultErrorCode,
      safeProviderMessage:
        resultDiagnostic?.safeProviderMessage ?? resultErrorMessage,
    },
  });
}

export function buildOutboundDispatchDiagnosticFromError(input: {
  submission: DiagnosticSubmission;
  provider: string;
  error: unknown;
  elapsedDispatchMs: number;
}): OutboundDispatchDiagnostic {
  const classified = classifyOutboundProviderError(input.error);
  return buildOutboundDispatchDiagnostic({
    submission: input.submission,
    provider: input.provider,
    elapsedDispatchMs: input.elapsedDispatchMs,
    ...classified,
    providerResponseReceived: classified.providerHttpStatus !== null,
    providerAcceptance: "unknown",
  });
}

export function encodeOutboundDispatchDiagnostic(
  diagnostic: OutboundDispatchDiagnostic,
): string {
  const encoded = `${OUTBOUND_DISPATCH_DIAGNOSTIC_PREFIX}${JSON.stringify(diagnostic)}`;
  if (encoded.length <= OUTBOUND_DISPATCH_DIAGNOSTIC_MAX_LENGTH) {
    return encoded;
  }
  return `${OUTBOUND_DISPATCH_DIAGNOSTIC_PREFIX}${JSON.stringify({
    ...diagnostic,
    providerErrorCategory: null,
    providerErrorCode: null,
    providerCorrelationId: null,
    responseContentType: null,
    safeProviderMessage: null,
  })}`;
}

export function decodeOutboundDispatchDiagnostic(
  value: string | null | undefined,
): OutboundDispatchDiagnostic | null {
  if (!value?.startsWith(OUTBOUND_DISPATCH_DIAGNOSTIC_PREFIX)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      value.slice(OUTBOUND_DISPATCH_DIAGNOSTIC_PREFIX.length),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { version?: unknown }).version ===
        OUTBOUND_DISPATCH_DIAGNOSTIC_VERSION
    ) {
      return parsed as OutboundDispatchDiagnostic;
    }
  } catch {
    return null;
  }
  return null;
}
