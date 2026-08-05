import { createHash } from "node:crypto";
import {
  summaryPriorityBand,
  type ReclamationSummaryCounts,
} from "./action-state";

export type SummaryFingerprintInput = {
  summaryScope: "staff_self" | "admin_team";
  recipientUserId: string;
  riskEpisodeKeys: string[];
  counts: ReclamationSummaryCounts;
};

export function buildCanonicalSummaryFingerprintPayload(
  input: SummaryFingerprintInput,
): Record<string, string | number | string[]> {
  const severity = summaryPriorityBand(input.counts);
  const riskEpisodeKeys = [...new Set(input.riskEpisodeKeys)].sort();

  return {
    scope: input.summaryScope,
    recipientUserId: input.recipientUserId,
    riskEpisodeKeys,
    total: input.counts.totalCount,
    tomorrow: input.counts.tomorrowCount,
    within7: input.counts.within7Count,
    within14: input.counts.within14Count,
    routine: input.counts.routineCount,
    earliest: input.counts.earliestReleaseAt ?? "",
    members: input.counts.memberCount ?? 0,
    severity,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashSummaryFingerprintPayload(
  payload: Record<string, string | number | string[]>,
): string {
  return createHash("sha256")
    .update(stableStringify(payload))
    .digest("hex");
}

export function buildSummaryFingerprint(input: SummaryFingerprintInput): string {
  const payload = buildCanonicalSummaryFingerprintPayload(input);
  return hashSummaryFingerprintPayload(payload);
}
