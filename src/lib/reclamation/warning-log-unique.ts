/**
 * Narrow classifier for reclamation_warning_logs UNIQUE(customer_id, warning_type, warning_date).
 * Does not treat other tables' unique failures as warning-log duplicates.
 */

function errorMessage(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current != null && depth < 4) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else if (typeof current === "string") {
      parts.push(current);
      break;
    } else {
      parts.push(String(current));
      break;
    }
    depth += 1;
  }
  return parts.join(" ");
}

export function isReclamationWarningLogUniqueConflictError(
  error: unknown,
): boolean {
  const lower = errorMessage(error).toLowerCase();
  if (
    !lower.includes("unique constraint failed") &&
    !lower.includes("sqlite_constraint_unique")
  ) {
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
