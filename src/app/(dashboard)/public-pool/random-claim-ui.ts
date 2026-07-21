/**
 * Pure helpers for Staff random-claim UI (testable without jsdom).
 * Server remains the source of truth for eligibility.
 */

import type { StaffClaimStatus } from "@/lib/public-pool/constants";

export const RANDOM_CLAIM_API_PATH = "/api/public-pool/claim-random";
export const CLAIM_STATUS_API_PATH = "/api/public-pool/claim-status";

/** Definite server outcomes — do not show partial-success uncertain copy. */
export const DEFINITE_RANDOM_CLAIM_ERROR_CODES = new Set([
  "CLAIM_COOLDOWN",
  "CLAIM_QUOTA_EXCEEDED",
  "PUBLIC_POOL_NO_ELIGIBLE_CUSTOMER",
  "PUBLIC_POOL_CANDIDATE_SCAN_LIMIT",
  "PUBLIC_POOL_RANDOM_CLAIM_CONFLICT",
  "CLAIM_METHOD_NOT_ALLOWED",
  "RANDOM_CLAIM_STAFF_ONLY",
  "RANDOM_CLAIM_BODY_NOT_ALLOWED",
  "INVALID_REQUEST_BODY",
  "CLAIM_STATUS_UNAVAILABLE",
  "CLAIM_SELF_RELEASED",
  "PUBLIC_POOL_CLIENT_ALREADY_CLAIMED",
]);

export type RandomClaimSuccessPayload = {
  ok: true;
  customerId: string;
  customerCode: string | null;
  customerName: string;
  taskId: string;
};

export function shouldShowStaffRandomClaim(isAdmin: boolean): boolean {
  return !isAdmin;
}

export function shouldShowRowClaimButton(isAdmin: boolean): boolean {
  return isAdmin;
}

export function shouldShowActionsColumn(isAdmin: boolean): boolean {
  return isAdmin;
}

export function isStaffRandomClaimDisabled(
  claimStatus: Pick<StaffClaimStatus, "canClaimNow">,
  claimingRandom: boolean,
): boolean {
  return claimingRandom || !claimStatus.canClaimNow;
}

export function staffRandomClaimDisabledReason(
  claimStatus: Pick<
    StaffClaimStatus,
    "canClaimNow" | "blockedReasonKey" | "remainingQuota"
  >,
  claimingRandom: boolean,
): "loading" | "quota" | "blocked" | null {
  if (claimingRandom) return "loading";
  if (claimStatus.canClaimNow) return null;
  if (
    claimStatus.blockedReasonKey === "quotaExceeded" ||
    claimStatus.remainingQuota <= 0
  ) {
    return "quota";
  }
  return "blocked";
}

/** POST with no body and no Content-Type — never send customerId/limit/role. */
export function createRandomClaimFetchInit(): RequestInit {
  return {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  };
}

export function isUncertainRandomClaimFailure(options: {
  networkError?: boolean;
  jsonParseFailed?: boolean;
  httpStatus?: number | null;
  errorCode?: string | null;
}): boolean {
  // Known business outcomes are definite even when HTTP is 5xx (e.g. scan limit 503).
  const code = options.errorCode?.trim() || null;
  if (code && DEFINITE_RANDOM_CLAIM_ERROR_CODES.has(code)) {
    return false;
  }

  if (options.networkError === true) return true;
  if (options.jsonParseFailed === true) return true;
  if (options.httpStatus != null && options.httpStatus >= 500) return true;
  return code == null;
}

export function parseRandomClaimSuccessBody(
  data: unknown,
): RandomClaimSuccessPayload | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.ok !== true) return null;
  if (typeof row.customerId !== "string" || !row.customerId) return null;
  if (typeof row.customerName !== "string") return null;
  if (typeof row.taskId !== "string" || !row.taskId) return null;
  const customerCode =
    row.customerCode === null || typeof row.customerCode === "string"
      ? (row.customerCode as string | null)
      : null;
  return {
    ok: true,
    customerId: row.customerId,
    customerCode,
    customerName: row.customerName,
    taskId: row.taskId,
  };
}

export function customerDetailHref(customerId: string): string {
  return `/customers/${customerId}`;
}
