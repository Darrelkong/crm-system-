export const LIFECYCLE_STATUS_COMPLETED = "completed" as const;

export type SalesStageListDisplay =
  | "pending_second_conversion"
  | "negotiation_reminder"
  | "plain";

export type PendingSecondConversionInput = {
  lifecycleStatus?: string | null;
  status: string;
  isArchived?: boolean;
  deletedAt?: string | null;
};

export function shouldShowPendingSecondConversionBadge(
  input: PendingSecondConversionInput,
): boolean {
  if (input.lifecycleStatus !== LIFECYCLE_STATUS_COMPLETED) {
    return false;
  }
  if (input.isArchived || input.status === "archived") {
    return false;
  }
  if (input.status === "public_pool") {
    return false;
  }
  if (input.deletedAt) {
    return false;
  }
  return true;
}

export function resolveSalesStageListDisplay(
  input: PendingSecondConversionInput & { salesStage: string },
): SalesStageListDisplay {
  if (shouldShowPendingSecondConversionBadge(input)) {
    return "pending_second_conversion";
  }
  if (input.salesStage === "negotiation") {
    return "negotiation_reminder";
  }
  return "plain";
}

const SALES_STAGE_BADGE_CLASS: Record<string, string> = {
  new_lead: "badge-stage-new-lead",
  contacted: "badge-stage-contacted",
  interested: "badge-stage-interested",
  proposal: "badge-stage-proposal",
  negotiation: "badge-stage-negotiation",
  negotiation_reminder: "badge-stage-negotiation",
  paid: "badge-stage-paid",
  closed_won: "badge-stage-closed-won",
  closed_lost: "badge-stage-closed-lost",
  on_hold: "badge-stage-on-hold",
  negotiating: "badge-stage-negotiation",
  converted: "badge-stage-closed-won",
  lost: "badge-stage-closed-lost",
  qualified: "badge-stage-qualified",
  invalid: "badge-stage-invalid",
  pending_second_conversion: "badge-stage-pending-second-conversion",
};

export function getSalesStageBadgeClass(stageOrDisplay: string): string {
  return SALES_STAGE_BADGE_CLASS[stageOrDisplay] ?? "badge-stage-unknown";
}
