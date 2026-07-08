export type AiConfidenceLevel = "high" | "medium" | "low";

export function resolveAiConfidenceLevel(confidence: number): AiConfidenceLevel {
  if (confidence >= 0.7) {
    return "high";
  }
  if (confidence >= 0.4) {
    return "medium";
  }
  return "low";
}

export function formatConfidencePercent(confidence: number): number {
  return Math.round(confidence * 100);
}
