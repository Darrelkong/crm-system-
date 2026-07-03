import type { AiErrorCode } from "@/lib/ai/customer-insights/errors";
import { AiAnalysisError } from "@/lib/ai/customer-insights/errors";
import { buildChatCompletionsUrl } from "@/lib/ai/providers/openai-compatible";
import type { ResolvedCustomerInsightProvider } from "@/lib/ai/providers/types";
import type { AiProviderKind } from "@/lib/settings/ai-keys";

export type AiProviderErrorType =
  | "provider_http_error"
  | "provider_empty_content"
  | "provider_json_parse_failed"
  | "schema_validation_failed"
  | "provider_request_failed";

export type AiProviderDiagnostics = {
  providerKind: AiProviderKind;
  model: string;
  providerErrorType: AiProviderErrorType;
  httpStatus?: number;
  requestUrlHost?: string;
  requestUrlPath?: string;
  contentLength?: number;
  parseStrategy?: "raw" | "fenced" | "extracted_object" | "none";
  firstNonWhitespaceChar?: string;
};

const SAFE_DIAGNOSTIC_KEYS = [
  "providerKind",
  "model",
  "httpStatus",
  "providerErrorType",
  "requestUrlHost",
  "requestUrlPath",
  "contentLength",
  "parseStrategy",
  "firstNonWhitespaceChar",
] as const satisfies ReadonlyArray<keyof AiProviderDiagnostics>;

export function getRequestUrlDiagnostics(apiBaseUrl: string): {
  requestUrlHost: string;
  requestUrlPath: string;
} {
  const url = new URL(buildChatCompletionsUrl(apiBaseUrl));
  return {
    requestUrlHost: url.hostname,
    requestUrlPath: url.pathname,
  };
}

export function buildProviderDiagnostics(
  config: { apiBaseUrl: string; model: string },
  providerKind: AiProviderKind,
  providerErrorType: AiProviderErrorType,
  httpStatus?: number,
  safeDetails?: Pick<
    AiProviderDiagnostics,
    "contentLength" | "parseStrategy" | "firstNonWhitespaceChar"
  >,
): AiProviderDiagnostics {
  const { requestUrlHost, requestUrlPath } = getRequestUrlDiagnostics(config.apiBaseUrl);
  return {
    providerKind,
    model: config.model,
    providerErrorType,
    requestUrlHost,
    requestUrlPath,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...safeDetails,
  };
}

export function buildResolvedProviderDiagnostics(
  resolved: ResolvedCustomerInsightProvider,
  providerErrorType: AiProviderErrorType,
  httpStatus?: number,
): AiProviderDiagnostics {
  if (resolved.config) {
    return buildProviderDiagnostics(
      resolved.config,
      resolved.kind,
      providerErrorType,
      httpStatus,
    );
  }

  return {
    providerKind: resolved.kind,
    model: resolved.model,
    providerErrorType,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  };
}

export function toSafeFailureAuditMetadata(
  diagnostics: AiProviderDiagnostics,
): Record<string, string | number> {
  const safe: Record<string, string | number> = {};
  for (const key of SAFE_DIAGNOSTIC_KEYS) {
    const value = diagnostics[key];
    if (value !== undefined) {
      safe[key] = value;
    }
  }
  return safe;
}

export function buildAiInsightRefreshFailedAuditMetadata(
  customerId: string,
  errorCode: AiErrorCode,
  error: unknown,
): Record<string, string | number> {
  const metadata: Record<string, string | number> = {
    customerId,
    errorCode,
  };

  if (error instanceof AiAnalysisError && error.diagnostics) {
    Object.assign(metadata, toSafeFailureAuditMetadata(error.diagnostics));
  }

  return metadata;
}
