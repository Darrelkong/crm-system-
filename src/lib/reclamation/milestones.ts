/**
 * Milestone-based auto-reclaim warnings (every 7 idle days + final 1-day warning).
 */

/** Periodic warning nodes: 7, 14, 21, … strictly before the final milestone. */
export function getPeriodicWarningMilestones(reclaimDays: number): number[] {
  const finalMilestone = reclaimDays - 1;
  const milestones: number[] = [];
  for (let day = 7; day < finalMilestone; day += 7) {
    milestones.push(day);
  }
  return milestones;
}

/** Final urgent warning window: last business day before reclaim. */
export function isInFinalWarningWindow(
  idleDays: number,
  reclaimDays: number,
): boolean {
  return idleDays >= reclaimDays - 1 && idleDays < reclaimDays;
}

/**
 * Returns the next milestone to warn at for this run, or null.
 * - Final window takes priority over periodic milestones.
 * - Periodic: highest reached milestone not yet sent (skip stale earlier nodes).
 */
export function resolveNextWarningMilestone(
  idleDays: number,
  reclaimDays: number,
  sentMilestones: ReadonlySet<number>,
): number | null {
  if (idleDays <= 0 || idleDays >= reclaimDays) {
    return null;
  }

  const finalMilestone = reclaimDays - 1;
  if (isInFinalWarningWindow(idleDays, reclaimDays)) {
    return sentMilestones.has(finalMilestone) ? null : finalMilestone;
  }

  const periodic = getPeriodicWarningMilestones(reclaimDays);
  let highestApplicable: number | null = null;
  for (const milestone of periodic) {
    if (milestone <= idleDays) {
      highestApplicable = milestone;
    } else {
      break;
    }
  }

  if (highestApplicable === null) {
    return null;
  }

  return sentMilestones.has(highestApplicable) ? null : highestApplicable;
}

/** @deprecated Use resolveNextWarningMilestone with sent-milestone set. */
export function getReclamationWarningMilestone(
  idleDays: number,
  reclaimDays: number,
): number | null {
  return resolveNextWarningMilestone(idleDays, reclaimDays, new Set());
}

/** 1-based sequence for periodic warnings (7→1, 14→2, …). Final milestone returns 0. */
export function getWarningSequenceNumber(
  milestone: number,
  reclaimDays: number,
): number {
  if (milestone === reclaimDays - 1) {
    return 0;
  }
  return milestone / 7;
}

export function isFinalReclamationWarning(
  milestone: number,
  reclaimDays: number,
): boolean {
  return milestone === reclaimDays - 1;
}

/** Maps to legacy DB warning_type CHECK constraint values. */
export function warningTypeForMilestone(
  milestone: number,
  reclaimDays: number,
): "day_6" | "day_7" {
  return isFinalReclamationWarning(milestone, reclaimDays) ? "day_7" : "day_6";
}

export function notificationTypeForMilestone(
  milestone: number,
  reclaimDays: number,
): "auto_reclaim_warning_day_6" | "auto_reclaim_warning_day_7" {
  return isFinalReclamationWarning(milestone, reclaimDays)
    ? "auto_reclaim_warning_day_7"
    : "auto_reclaim_warning_day_6";
}

export function buildWarningTimelineMessage(input: {
  milestone: number;
  idleDays: number;
  reclaimDays: number;
  isFinal: boolean;
}): string {
  const ruleLine = `当时自动释放规则：${input.reclaimDays} 天。`;
  if (input.isFinal) {
    return [
      "系统紧急回收预警",
      "",
      "该客户将在 1 天后自动释放至公共池，请尽快完成有效跟进。",
      "",
      ruleLine,
    ].join("\n");
  }

  const sequence = getWarningSequenceNumber(input.milestone, input.reclaimDays);
  const daysRemaining = input.reclaimDays - input.idleDays;
  return [
    `系统自动回收预警（第 ${sequence} 次）`,
    "",
    `该客户已连续 ${input.idleDays} 天未新增有效跟进，距自动释放至公共池还有 ${daysRemaining} 天。`,
    "",
    ruleLine,
  ].join("\n");
}

export function buildReclaimTimelineMessage(reclaimDays: number): string {
  return [
    "系统自动释放记录",
    "",
    `该客户因连续 ${reclaimDays} 天未新增有效跟进，已自动释放至公共池，原客户归属关系已解除。`,
    "",
    `当时自动释放规则：${reclaimDays} 天。`,
  ].join("\n");
}
