/**
 * Narrow classifier for reclamation_warning_logs UNIQUE(customer_id, warning_type, warning_date).
 * Does not treat other tables' unique failures as warning-log duplicates.
 */

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error ?? "");
}

export function isReclamationWarningLogUniqueConflictError(
  error: unknown,
): boolean {
  const lower = errorMessage(error).toLowerCase();
  if (!lower.includes("unique constraint failed")) {
    return false;
  }

  if (lower.includes("idx_reclamation_warning_unique")) {
    return true;
  }

  if (!lower.includes("reclamation_warning_logs")) {
    return false;
  }

  return (
    lower.includes("warning_date") ||
    lower.includes("warning_type") ||
    lower.includes("warning_milestone") ||
    lower.includes("cycle_started_at") ||
    lower.includes("customer_id")
  );
}
