import type { FollowUpOrganizationResult } from "@/lib/ai/follow-up-organize/types";
import type { FollowUpOrganizeAvailability } from "@/lib/ai/follow-up-organize/types";

/** Keys that must never appear in organize API JSON responses. */
export const FOLLOW_UP_ORGANIZE_FORBIDDEN_RESPONSE_KEYS = [
  "prompt",
  "systemPrompt",
  "userPrompt",
  "providerRaw",
  "rawResponse",
  "apiKey",
  "stack",
  "sql",
  "session",
  "accessEmail",
  "passwordHash",
  "reservationKey",
  "eventId",
] as const;

export type FollowUpOrganizeApiSuccessBody = {
  result: FollowUpOrganizationResult;
  availability: FollowUpOrganizeAvailability;
};

export function assertFollowUpOrganizeResponseSafe(
  body: unknown,
): body is FollowUpOrganizeApiSuccessBody {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  for (const key of FOLLOW_UP_ORGANIZE_FORBIDDEN_RESPONSE_KEYS) {
    if (key in record) return false;
  }
  if (!("result" in record) || !("availability" in record)) return false;
  const result = record.result as Record<string, unknown> | null;
  if (!result || typeof result !== "object") return false;
  for (const key of FOLLOW_UP_ORGANIZE_FORBIDDEN_RESPONSE_KEYS) {
    if (key in result) return false;
  }
  return true;
}

/** Shared reject list for client override fields on organize routes. */
export const FOLLOW_UP_ORGANIZE_CLIENT_OVERRIDE_KEYS = [
  "role",
  "provider",
  "prompt",
  "model",
  "dailyLimit",
  "userId",
  "operationType",
] as const;

export function hasFollowUpOrganizeClientOverride(
  body: Record<string, unknown>,
): boolean {
  return FOLLOW_UP_ORGANIZE_CLIENT_OVERRIDE_KEYS.some(
    (key) => body[key] !== undefined,
  );
}
