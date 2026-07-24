import type { AiProviderDiagnostics } from "@/lib/ai/customer-insights/diagnostics";

export type AiErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_CONFIG_ERROR"
  | "AI_ANALYSIS_FAILED"
  | "AI_PROVIDER_TEMPORARILY_UNAVAILABLE"
  | "AI_RATE_LIMITED"
  | "AI_PROVIDER_TIMEOUT"
  | "AI_PROVIDER_RESPONSE_INVALID"
  | "AI_REFRESH_DENIED"
  | "AI_REFRESH_COOLDOWN"
  | "AI_PROVIDER_ERROR"
  | "AI_STAFF_DEEP_ANALYSIS_DISABLED"
  | "AI_STAFF_DAILY_LIMIT_REACHED"
  | "AI_STAFF_RESERVATION_CONFLICT"
  | "AI_DEEP_ANALYSIS_MOCK_ONLY"
  | "AI_DEEP_ANALYSIS_GLOBAL_DISABLED";

export class AiConfigError extends Error {
  readonly code: AiErrorCode;

  constructor(message = "AI 尚未完成配置", code: AiErrorCode = "AI_NOT_CONFIGURED") {
    super(message);
    this.name = "AiConfigError";
    this.code = code;
  }
}

export class AiAnalysisError extends Error {
  readonly code: AiErrorCode;
  readonly diagnostics?: AiProviderDiagnostics;

  constructor(
    message = "AI 分析失败，请稍后重试",
    diagnostics?: AiProviderDiagnostics,
    code: AiErrorCode = "AI_ANALYSIS_FAILED",
  ) {
    super(message);
    this.name = "AiAnalysisError";
    this.diagnostics = diagnostics;
    this.code = code;
  }
}

export class AiRefreshDeniedError extends Error {
  readonly code: AiErrorCode = "AI_REFRESH_DENIED";

  constructor(message = "当前设置不允许手动刷新 AI 分析") {
    super(message);
    this.name = "AiRefreshDeniedError";
  }
}

export class AiRefreshCooldownError extends Error {
  readonly code: AiErrorCode = "AI_REFRESH_COOLDOWN";

  constructor(message = "AI 分析刚刚已刷新，请稍后再试") {
    super(message);
    this.name = "AiRefreshCooldownError";
  }
}

export class AiProviderError extends Error {
  readonly code: AiErrorCode = "AI_PROVIDER_ERROR";
  readonly diagnostics?: AiProviderDiagnostics;

  constructor(diagnostics?: AiProviderDiagnostics, message = "AI 分析失败，请稍后重试") {
    super(message);
    this.name = "AiProviderError";
    this.diagnostics = diagnostics;
  }
}

export class AiStaffDeepAnalysisDisabledError extends Error {
  readonly code: AiErrorCode = "AI_STAFF_DEEP_ANALYSIS_DISABLED";

  constructor(message = "管理员目前未开放员工 AI 深度分析") {
    super(message);
    this.name = "AiStaffDeepAnalysisDisabledError";
  }
}

export class AiStaffDailyLimitReachedError extends Error {
  readonly code: AiErrorCode = "AI_STAFF_DAILY_LIMIT_REACHED";

  constructor(message = "今日 AI 深度分析次数已用完") {
    super(message);
    this.name = "AiStaffDailyLimitReachedError";
  }
}

export class AiStaffReservationConflictError extends Error {
  readonly code: AiErrorCode = "AI_STAFF_RESERVATION_CONFLICT";

  constructor(message = "请重新发起 AI 深度分析") {
    super(message);
    this.name = "AiStaffReservationConflictError";
  }
}

export class AiDeepAnalysisGlobalDisabledError extends Error {
  readonly code: AiErrorCode = "AI_DEEP_ANALYSIS_GLOBAL_DISABLED";

  constructor(message = "AI 深度分析目前未启用") {
    super(message);
    this.name = "AiDeepAnalysisGlobalDisabledError";
  }
}

export class AiDeepAnalysisMockOnlyError extends Error {
  readonly code: AiErrorCode = "AI_DEEP_ANALYSIS_MOCK_ONLY";

  constructor(message = "AI 深度分析目前不可用") {
    super(message);
    this.name = "AiDeepAnalysisMockOnlyError";
  }
}
