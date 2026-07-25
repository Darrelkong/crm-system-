import type { AiEffectRateClient } from "@/components/admin/ai-effect-stats/parse-ai-effect-stats-response";
import { tagLabelKey } from "@/components/customers/ai-insight-component-feedback";
import type { ComponentFeedbackUiTarget } from "@/components/customers/ai-insight-component-feedback";

/** Client-safe copy of Phase 2 degradation reason allowlist (matches backend). */
export const AI_EFFECT_STATS_DEGRADATION_REASON_CODES = [
  "missing_signals",
  "invalid_signal_schema",
  "forbidden_score_injection",
  "invalid_evidence",
  "fact_safety_rejected",
  "local_composition_failed",
] as const;

export function formatAiEffectCount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale ?? undefined).format(Math.trunc(value));
}

export type AiEffectRateDisplay = {
  kind: "percent" | "insufficient";
  percentText: string | null;
  fractionText: string;
};

/** Formats API rate for display. Never invents rates; denom 0 → insufficient. */
export function formatAiEffectRate(
  rate: AiEffectRateClient,
  locale?: string,
): AiEffectRateDisplay {
  const fractionText = `${formatAiEffectCount(rate.numerator, locale)} / ${formatAiEffectCount(rate.denominator, locale)}`;
  if (rate.denominator === 0 || rate.value == null) {
    return {
      kind: "insufficient",
      percentText: null,
      fractionText,
    };
  }
  const percent = rate.value * 100;
  const rounded =
    Math.abs(percent - Math.round(percent)) < 0.05
      ? Math.round(percent).toFixed(0)
      : percent.toFixed(1);
  return {
    kind: "percent",
    percentText: `${rounded}%`,
    fractionText,
  };
}

export function componentTagI18nKey(
  target: ComponentFeedbackUiTarget,
  code: string,
): string {
  return tagLabelKey(target, code);
}

export function legacyTagI18nKey(code: string): string {
  return `customers.aiInsightFeedback.reasonTags.${code}`;
}

export function degradationReasonI18nKey(code: string): string {
  if (
    (AI_EFFECT_STATS_DEGRADATION_REASON_CODES as readonly string[]).includes(
      code,
    )
  ) {
    return `aiEffectStats.degradationReasons.${code}`;
  }
  return "aiEffectStats.degradationReasons.unknown";
}
