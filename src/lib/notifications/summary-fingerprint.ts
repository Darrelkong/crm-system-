import {
  summaryPriorityBand,
  type ReclamationSummaryCounts,
} from "./action-state";

export function buildSummaryFingerprint(input: {
  summaryScope: "staff_self" | "admin_team";
  counts: ReclamationSummaryCounts;
}): string {
  const severity = summaryPriorityBand(input.counts);
  return JSON.stringify({
    scope: input.summaryScope,
    total: input.counts.totalCount,
    tomorrow: input.counts.tomorrowCount,
    within7: input.counts.within7Count,
    within14: input.counts.within14Count,
    routine: input.counts.routineCount,
    earliest: input.counts.earliestReleaseAt ?? "",
    members: input.counts.memberCount ?? 0,
    severity,
  });
}
