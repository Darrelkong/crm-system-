import { and, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

export const STAFF_ACCESS_EMAIL_BINDING_OUTCOMES = {
  BOUND_NOW: "BOUND_NOW",
  ALREADY_BOUND_MATCH: "ALREADY_BOUND_MATCH",
  ACCESS_EMAIL_MISMATCH: "ACCESS_EMAIL_MISMATCH",
  ACCESS_EMAIL_ALREADY_USED: "ACCESS_EMAIL_ALREADY_USED",
  LEGACY_MATCH_UNBOUND: "LEGACY_MATCH_UNBOUND",
  LEGACY_ACCESS_EMAIL_TARGET_MISMATCH: "LEGACY_ACCESS_EMAIL_TARGET_MISMATCH",
  INVALID_ACCESS_EMAIL: "INVALID_ACCESS_EMAIL",
  NOT_STAFF: "NOT_STAFF",
  ACCOUNT_NOT_ELIGIBLE: "ACCOUNT_NOT_ELIGIBLE",
} as const;

export type StaffAccessEmailBindingOutcome =
  (typeof STAFF_ACCESS_EMAIL_BINDING_OUTCOMES)[keyof typeof STAFF_ACCESS_EMAIL_BINDING_OUTCOMES];

export function normalizeAccessEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidAccessEmail(value: string): boolean {
  const atIndex = value.indexOf("@");
  return (
    value.length > 0 &&
    value.length <= 320 &&
    !/\s/.test(value) &&
    atIndex > 0 &&
    atIndex === value.lastIndexOf("@") &&
    atIndex < value.length - 1
  );
}

type StaffAccessEmailBindingInput = {
  userId: string;
  role: User["role"];
  isActive: number;
  deletedAt: string | null;
  lockedUntil: string | null;
  storedAccessEmail: string | null;
  loginEmail: string;
  verifiedAccessEmail: string | null | undefined;
};

function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const message =
      current instanceof Error
        ? current.message
        : typeof current === "string"
          ? current
          : "";
    if (/UNIQUE constraint failed/i.test(message)) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : null;
  }
  return false;
}

/**
 * Enforces the Staff-only Access identity binding after CRM credentials have
 * already been verified. This function never overwrites an existing binding.
 */
export async function enforceStaffAccessEmailBinding(
  db: Database,
  input: StaffAccessEmailBindingInput,
): Promise<StaffAccessEmailBindingOutcome> {
  if (input.role !== "staff") {
    return STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.NOT_STAFF;
  }
  if (input.isActive !== 1 || input.deletedAt !== null || input.lockedUntil !== null) {
    return STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ACCOUNT_NOT_ELIGIBLE;
  }

  const normalizedVerifiedEmail =
    typeof input.verifiedAccessEmail === "string"
      ? normalizeAccessEmail(input.verifiedAccessEmail)
      : "";
  if (!isValidAccessEmail(normalizedVerifiedEmail)) {
    return STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.INVALID_ACCESS_EMAIL;
  }
  const normalizedLoginEmail = normalizeAccessEmail(input.loginEmail);

  if (input.storedAccessEmail !== null) {
    return normalizeAccessEmail(input.storedAccessEmail) === normalizedVerifiedEmail
      ? STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ALREADY_BOUND_MATCH
      : STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ACCESS_EMAIL_MISMATCH;
  }

  const [legacyAccessOwner] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.email, normalizedVerifiedEmail),
        eq(schema.users.role, "staff"),
      ),
    )
    .limit(1);
  if (legacyAccessOwner && legacyAccessOwner.id !== input.userId) {
    return STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.LEGACY_ACCESS_EMAIL_TARGET_MISMATCH;
  }
  if (
    legacyAccessOwner?.id === input.userId &&
    normalizedVerifiedEmail === normalizedLoginEmail
  ) {
    return STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.LEGACY_MATCH_UNBOUND;
  }

  try {
    const result = await db
      .update(schema.users)
      .set({
        cloudflareAccessEmail: normalizedVerifiedEmail,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.users.id, input.userId),
          eq(schema.users.role, "staff"),
          isNull(schema.users.cloudflareAccessEmail),
        ),
      )
      .run();

    if ((result.meta?.changes ?? 0) === 1) {
      return STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.BOUND_NOW;
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ACCESS_EMAIL_ALREADY_USED;
    }
    throw error;
  }

  const [current] = await db
    .select({
      role: schema.users.role,
      cloudflareAccessEmail: schema.users.cloudflareAccessEmail,
    })
    .from(schema.users)
    .where(eq(schema.users.id, input.userId))
    .limit(1);

  if (
    current?.role === "staff" &&
    current.cloudflareAccessEmail &&
    normalizeAccessEmail(current.cloudflareAccessEmail) === normalizedVerifiedEmail
  ) {
    return STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ALREADY_BOUND_MATCH;
  }

  if (current?.cloudflareAccessEmail) {
    return STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ACCESS_EMAIL_MISMATCH;
  }

  return STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ACCESS_EMAIL_ALREADY_USED;
}
