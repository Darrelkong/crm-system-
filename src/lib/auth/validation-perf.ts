import { cache } from "react";

export type AuthValidationPerf = {
  authSessionReadMs: number;
  authPolicyReadMs: number;
  authInitialParallelMs: number;
  authDeviceMs: number;
  authTouchMs: number;
};

const getAuthValidationPerfStore = cache(
  (): { timings: AuthValidationPerf | null } => ({
    timings: null,
  }),
);

export function recordAuthValidationPerf(timings: AuthValidationPerf): void {
  getAuthValidationPerfStore().timings = timings;
}

export function getAuthValidationPerf(): AuthValidationPerf | null {
  return getAuthValidationPerfStore().timings;
}

export function clearAuthValidationPerf(): void {
  getAuthValidationPerfStore().timings = null;
}
