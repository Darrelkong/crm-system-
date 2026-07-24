import type { AiProviderDiagnostics } from "@/lib/ai/customer-insights/diagnostics";
import {
  AiAnalysisError,
  AiConfigError,
  AiRefreshCooldownError,
  AiRefreshDeniedError,
  AiStaffDailyLimitReachedError,
  AiStaffDeepAnalysisDisabledError,
  AiStaffFollowUpOrganizationDisabledError,
  AiStaffReservationConflictError,
  AiDeepAnalysisGlobalDisabledError,
  AiDeepAnalysisMockOnlyError,
  type AiErrorCode,
} from "@/lib/ai/customer-insights/errors";
import { StaffAiQuotaError } from "@/lib/ai/staff-usage/service";

export type AiAnalysisErrorCode = Extract<
  AiErrorCode,
  | "AI_ANALYSIS_FAILED"
  | "AI_PROVIDER_TEMPORARILY_UNAVAILABLE"
  | "AI_RATE_LIMITED"
  | "AI_PROVIDER_TIMEOUT"
  | "AI_PROVIDER_RESPONSE_INVALID"
>;

export function mapAiAnalysisErrorCode(
  diagnostics?: AiProviderDiagnostics,
): AiAnalysisErrorCode {
  if (!diagnostics) {
    return "AI_ANALYSIS_FAILED";
  }

  switch (diagnostics.providerErrorType) {
    case "provider_request_failed":
      return "AI_PROVIDER_TIMEOUT";
    case "provider_empty_content":
    case "provider_json_parse_failed":
    case "schema_validation_failed":
    case "provider_response_too_large":
      return "AI_PROVIDER_RESPONSE_INVALID";
    case "provider_http_error":
      if (diagnostics.httpStatus === 503) {
        return "AI_PROVIDER_TEMPORARILY_UNAVAILABLE";
      }
      if (diagnostics.httpStatus === 429) {
        return "AI_RATE_LIMITED";
      }
      return "AI_ANALYSIS_FAILED";
    default:
      return "AI_ANALYSIS_FAILED";
  }
}

export function resolveAiRefreshErrorCode(error: unknown): AiErrorCode {
  if (error instanceof AiConfigError) {
    return error.code;
  }
  if (error instanceof AiRefreshDeniedError) {
    return error.code;
  }
  if (error instanceof AiRefreshCooldownError) {
    return error.code;
  }
  if (error instanceof AiStaffDeepAnalysisDisabledError) {
    return error.code;
  }
  if (error instanceof AiStaffFollowUpOrganizationDisabledError) {
    return error.code;
  }
  if (error instanceof AiStaffDailyLimitReachedError) {
    return error.code;
  }
  if (error instanceof AiStaffReservationConflictError) {
    return error.code;
  }
  if (error instanceof AiDeepAnalysisGlobalDisabledError) {
    return error.code;
  }
  if (error instanceof AiDeepAnalysisMockOnlyError) {
    return error.code;
  }
  if (error instanceof StaffAiQuotaError) {
    return error.code === "AI_STAFF_RESERVATION_CONFLICT"
      ? "AI_STAFF_RESERVATION_CONFLICT"
      : error.code;
  }
  if (error instanceof AiAnalysisError) {
    return error.code;
  }
  return "AI_ANALYSIS_FAILED";
}

/** Safe API-facing message keyed by errorCode; never includes provider raw errors. */
export function getSafeAiRefreshErrorMessage(errorCode: AiErrorCode): string {
  switch (errorCode) {
    case "AI_NOT_CONFIGURED":
    case "AI_CONFIG_ERROR":
      return "AI 尚未完成設定，請聯絡管理員。";
    case "AI_PROVIDER_TEMPORARILY_UNAVAILABLE":
      return "AI 服務暫時不可用，請稍後再試。";
    case "AI_RATE_LIMITED":
      return "AI 服務目前請求較多，請稍後再試。";
    case "AI_PROVIDER_TIMEOUT":
      return "AI 分析逾時，請稍後再試。";
    case "AI_PROVIDER_RESPONSE_INVALID":
      return "AI 回應格式異常，請稍後再試或聯絡管理員。";
    case "AI_REFRESH_DENIED":
      return "目前設定不允許您手動刷新 AI 分析。";
    case "AI_REFRESH_COOLDOWN":
      return "此客戶剛完成分析，請稍後再試。";
    case "AI_STAFF_DEEP_ANALYSIS_DISABLED":
      return "管理員目前未開放客戶 AI 深度分析。你仍可使用基礎系統分析。";
    case "AI_STAFF_FOLLOW_UP_ORGANIZATION_DISABLED":
      return "管理員目前未開放跟進 AI 智能整理。你仍可使用基礎整理。";
    case "AI_STAFF_DAILY_LIMIT_REACHED":
      return "今日 AI 使用次數已用完。";
    case "AI_STAFF_RESERVATION_CONFLICT":
      return "本次請求未能開始，請重新整理頁面後再試。";
    case "AI_DEEP_ANALYSIS_GLOBAL_DISABLED":
      return "AI 深度分析目前未啟用，當前顯示的是基礎系統分析。";
    case "AI_DEEP_ANALYSIS_MOCK_ONLY":
      return "AI 深度分析暫時不可用，你仍可查看基礎系統分析。";
    case "AI_ANALYSIS_FAILED":
    case "AI_PROVIDER_ERROR":
    default:
      return "AI 深度分析暫時不可用，你仍可查看基礎系統分析。";
  }
}
