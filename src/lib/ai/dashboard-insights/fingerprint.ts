import { createHash } from "node:crypto";
import type { DashboardAiInsightType } from "./types";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function buildDashboardAiContextFingerprint(input: {
  viewerRole: string;
  viewerId: string;
  insightType: DashboardAiInsightType;
  locale: string;
  context: unknown;
}): string {
  const payload = stableStringify({
    role: input.viewerRole,
    userId: input.viewerId,
    insightType: input.insightType,
    locale: input.locale,
    context: input.context,
  });
  return createHash("sha256").update(payload).digest("hex");
}
