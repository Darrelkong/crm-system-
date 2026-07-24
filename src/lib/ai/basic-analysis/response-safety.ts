import type { BasicCustomerAnalysis } from "@/lib/ai/basic-analysis/types";

const FORBIDDEN_RESPONSE_KEYS = [
  "phone",
  "wechatId",
  "wechat",
  "email",
  "address",
  "content",
  "prompt",
  "apiKey",
  "api_key",
  "stack",
  "password",
  "passwordHash",
] as const;

function hasJsonProperty(json: string, key: string): boolean {
  return new RegExp(`"${key}"\\s*:`).test(json);
}

/**
 * Asserts a basic-analysis payload does not embed sensitive CRM values.
 * Used by unit tests; also safe to call before returning API responses.
 */
export function assertBasicAnalysisResponseSafe(
  analysis: BasicCustomerAnalysis | null,
): void {
  if (!analysis) return;
  const json = JSON.stringify(analysis);
  for (const key of FORBIDDEN_RESPONSE_KEYS) {
    if (hasJsonProperty(json, key)) {
      throw new Error(`Basic analysis response contains forbidden key: ${key}`);
    }
  }
  for (const finding of analysis.findings) {
    if (finding.evidence.field === "phone_or_wechat" && finding.evidence.value) {
      throw new Error("Contact evidence must not include raw phone/wechat values");
    }
    if (finding.evidence.field === "nextAction" && finding.evidence.value) {
      throw new Error("nextAction evidence must not include action body text");
    }
  }
}

export function basicAnalysisContainsForbiddenKeys(
  analysis: BasicCustomerAnalysis | null,
): string[] {
  if (!analysis) return [];
  const json = JSON.stringify(analysis);
  return FORBIDDEN_RESPONSE_KEYS.filter((key) => hasJsonProperty(json, key));
}
