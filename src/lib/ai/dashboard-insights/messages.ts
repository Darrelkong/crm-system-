import type { AiAnalysisLanguage } from "@/lib/settings/ai-keys";
import type { DashboardAiResultStatus } from "./types";

const MESSAGES: Record<
  AiAnalysisLanguage,
  Record<DashboardAiResultStatus, string>
> = {
  "zh-Hant": {
    success: "",
    unavailable: "AI 服務暫時不可用",
    disabled: "AI 功能目前未啟用",
    rate_limited: "請稍後再試",
    timeout: "AI 服務暫時不可用",
    invalid_response: "AI 服務暫時不可用",
  },
  "zh-Hans": {
    success: "",
    unavailable: "AI 服务暂时不可用",
    disabled: "AI 功能目前未启用",
    rate_limited: "请稍后再试",
    timeout: "AI 服务暂时不可用",
    invalid_response: "AI 服务暂时不可用",
  },
  en: {
    success: "",
    unavailable: "AI service is temporarily unavailable",
    disabled: "AI is currently disabled",
    rate_limited: "Please try again later",
    timeout: "AI service is temporarily unavailable",
    invalid_response: "AI service is temporarily unavailable",
  },
};

export function getDashboardAiSafeMessage(
  status: DashboardAiResultStatus,
  locale: AiAnalysisLanguage,
): string {
  return MESSAGES[locale][status] ?? MESSAGES.en[status];
}
