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
