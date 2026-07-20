import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { AuthorizedDeviceStatus } from "../../../drizzle/schema/authorized-devices";
import type { User } from "../../../drizzle/schema/users";

/**
 * Server-only: whether the user currently holds one-time first-device
 * auto-approval eligibility. Never trust a client-supplied boolean.
 */
export function hasInitialDeviceAutoApprovalEligibility(
  user: Pick<User, "role" | "initialDeviceAutoApprovalEligible">,
): boolean {
  return (
    user.role === "staff" && user.initialDeviceAutoApprovalEligible === 1
  );
}

export type InitialActivationRestrictedSessionInput = {
  role: User["role"];
  mustChangePassword: number;
  initialDeviceAutoApprovalEligible: number;
  deviceAuthorizationEnabled: boolean;
  deviceStatus: AuthorizedDeviceStatus | null;
  deviceBelongsToUser: boolean;
  approvedCount: number;
  deviceLimit: number;
};

/**
 * Pure server-side check: may a Staff with a Pending device receive a
 * must-change-password–restricted session (device stays Pending).
 * Does not write DB / Audit / cookies.
 */
export function canCreateInitialActivationRestrictedSession(
  input: InitialActivationRestrictedSessionInput,
): boolean {
  if (!input.deviceAuthorizationEnabled) {
    return false;
  }
  if (input.role !== "staff") {
    return false;
  }
  if (input.mustChangePassword !== 1) {
    return false;
  }
  if (input.initialDeviceAutoApprovalEligible !== 1) {
    return false;
  }
  if (!input.deviceBelongsToUser) {
    return false;
  }
  if (input.deviceStatus !== "pending") {
    return false;
  }
  if (input.approvedCount !== 0) {
    return false;
  }
  if (input.approvedCount >= input.deviceLimit) {
    return false;
  }
  if (input.deviceLimit < 1) {
    return false;
  }
  return true;
}

/**
 * Build a Drizzle update statement that clears eligibility to 0.
 * Intended for inclusion in the same `db.batch` as device status changes.
 */
export function buildConsumeInitialDeviceAutoApprovalEligibilityStatement(
  database: Database,
  userId: string,
  now: string,
) {
  return database
    .update(schema.users)
    .set({
      initialDeviceAutoApprovalEligible: 0,
      updatedAt: now,
    })
    .where(eq(schema.users.id, userId));
}

/** Eligibility value when creating a user account (Staff=1, Admin=0). */
export function initialDeviceAutoApprovalEligibleForNewRole(
  role: User["role"],
): 0 | 1 {
  return role === "staff" ? 1 : 0;
}
