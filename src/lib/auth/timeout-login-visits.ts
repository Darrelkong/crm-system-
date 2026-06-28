export function isTimeoutLoginReason(
  reason: string | null,
  sessionEnd: string | null,
): boolean {
  return reason === "timeout" || sessionEnd === "idle";
}
