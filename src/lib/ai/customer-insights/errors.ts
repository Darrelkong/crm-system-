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
  | "AI_PROVIDER_ERROR";

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
