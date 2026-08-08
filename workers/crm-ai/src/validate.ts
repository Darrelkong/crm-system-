import { MAX_SUMMARY_LENGTH } from "./models";
import type { HealthProbeOutput } from "./types";

export function validateHealthProbeOutput(
  value: unknown,
): value is HealthProbeOutput {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.status === "ok" &&
    typeof record.summary === "string" &&
    record.summary.trim().length > 0 &&
    record.summary.length <= MAX_SUMMARY_LENGTH
  );
}
