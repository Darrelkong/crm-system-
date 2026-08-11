export type CustomerDetailPerfTimings = {
  serverDataReadyTotalMs: number;
  authMs: number;
  customerLookupMs: number;
  pendingApprovalMs: number;
  accessResolutionMs: number;
  scoringMs: number;
  secondaryTotalMs: number;
  followUpsMs: number;
  timelineMs: number;
  confirmNameMs: number;
  userLabelsMs: number;
  assigneeNamesMs: number;
};

export function shouldEnableCustomerDetailPerf(
  role: string,
  perfParam: string | undefined,
): boolean {
  return role === "admin" && perfParam === "1";
}

export function perfNow(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

export async function measureAsync<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const start = perfNow();
  const result = await fn();
  return { result, durationMs: perfNow() - start };
}

export function roundPerfMs(ms: number): string {
  const rounded = Math.round(ms * 10) / 10;
  return `${rounded} ms`;
}
