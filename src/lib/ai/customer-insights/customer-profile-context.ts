/**
 * Optional customerProfile slice for AI deep-analysis context.
 * Only the 8 allowlisted fields; gender / age_range are never included.
 */

import {
  CUSTOMER_PROFILE_TEXT_LIMITS,
  isCustomerPreferredContactMethod,
  isCustomerPreferredLanguage,
  normalizeOptionalProfileText,
} from "@/lib/customers/customer-profile";
import { AI_CONTEXT_TRUNCATION_SUFFIX } from "@/lib/ai/customer-insights/limits";

/** CamelCase profile keys sent inside AI context JSON (non-empty only). */
export type CustomerInsightProfile = {
  preferredName?: string;
  preferredLanguage?: string;
  preferredContactMethod?: string;
  occupation?: string;
  companyName?: string;
  jobTitle?: string;
  targetCountryOrRegion?: string;
  primaryConcern?: string;
};

/** Stable key order for hash / serialization consistency. */
export const CUSTOMER_INSIGHT_PROFILE_KEYS = [
  "preferredName",
  "preferredLanguage",
  "preferredContactMethod",
  "occupation",
  "companyName",
  "jobTitle",
  "targetCountryOrRegion",
  "primaryConcern",
] as const satisfies ReadonlyArray<keyof CustomerInsightProfile>;

export type CustomerInsightProfileKey =
  (typeof CUSTOMER_INSIGHT_PROFILE_KEYS)[number];

/** Matches customer-profile text limits (single source of truth). */
export const AI_CUSTOMER_PROFILE_TEXT_LIMITS = {
  preferredName: CUSTOMER_PROFILE_TEXT_LIMITS.preferredName,
  occupation: CUSTOMER_PROFILE_TEXT_LIMITS.occupation,
  companyName: CUSTOMER_PROFILE_TEXT_LIMITS.companyName,
  jobTitle: CUSTOMER_PROFILE_TEXT_LIMITS.jobTitle,
  targetCountryOrRegion: CUSTOMER_PROFILE_TEXT_LIMITS.targetCountryOrRegion,
  primaryConcern: CUSTOMER_PROFILE_TEXT_LIMITS.primaryConcern,
} as const;

/**
 * Strip C0 controls except TAB/LF/CR, plus DEL.
 * Intentionally minimal — no HTML parsing.
 */
const DANGEROUS_CONTROL_CHARS_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function stripDangerousControlChars(value: string): string {
  return value.replace(DANGEROUS_CONTROL_CHARS_RE, "");
}

function truncateProfileText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + AI_CONTEXT_TRUNCATION_SUFFIX;
}

function sanitizeOptionalProfileText(
  value: string | null | undefined,
  maxChars: number,
): string | undefined {
  const normalized = normalizeOptionalProfileText(value);
  if (!normalized) return undefined;
  const cleaned = stripDangerousControlChars(normalized).trim();
  if (!cleaned) return undefined;
  return truncateProfileText(cleaned, maxChars);
}

function sanitizeOptionalProfileEnum(
  value: string | null | undefined,
  isValid: (v: string) => boolean,
): string | undefined {
  const normalized = normalizeOptionalProfileText(value);
  if (!normalized) return undefined;
  const cleaned = stripDangerousControlChars(normalized).trim();
  if (!cleaned || !isValid(cleaned)) return undefined;
  return cleaned;
}

export type CustomerInsightProfileSource = {
  preferredName?: string | null;
  preferredLanguage?: string | null;
  preferredContactMethod?: string | null;
  occupation?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  targetCountryOrRegion?: string | null;
  primaryConcern?: string | null;
  /** Explicitly ignored if present — never forwarded to AI. */
  gender?: string | null;
  ageRange?: string | null;
};

/**
 * Build a non-empty customerProfile for AI context from allowlisted fields.
 * Returns undefined when every field is empty / invalid (omit key entirely).
 */
export function buildCustomerInsightProfile(
  source: CustomerInsightProfileSource,
): CustomerInsightProfile | undefined {
  const profile: CustomerInsightProfile = {};

  const preferredName = sanitizeOptionalProfileText(
    source.preferredName,
    AI_CUSTOMER_PROFILE_TEXT_LIMITS.preferredName,
  );
  if (preferredName) profile.preferredName = preferredName;

  const preferredLanguage = sanitizeOptionalProfileEnum(
    source.preferredLanguage,
    isCustomerPreferredLanguage,
  );
  if (preferredLanguage) profile.preferredLanguage = preferredLanguage;

  const preferredContactMethod = sanitizeOptionalProfileEnum(
    source.preferredContactMethod,
    isCustomerPreferredContactMethod,
  );
  if (preferredContactMethod) {
    profile.preferredContactMethod = preferredContactMethod;
  }

  const occupation = sanitizeOptionalProfileText(
    source.occupation,
    AI_CUSTOMER_PROFILE_TEXT_LIMITS.occupation,
  );
  if (occupation) profile.occupation = occupation;

  const companyName = sanitizeOptionalProfileText(
    source.companyName,
    AI_CUSTOMER_PROFILE_TEXT_LIMITS.companyName,
  );
  if (companyName) profile.companyName = companyName;

  const jobTitle = sanitizeOptionalProfileText(
    source.jobTitle,
    AI_CUSTOMER_PROFILE_TEXT_LIMITS.jobTitle,
  );
  if (jobTitle) profile.jobTitle = jobTitle;

  const targetCountryOrRegion = sanitizeOptionalProfileText(
    source.targetCountryOrRegion,
    AI_CUSTOMER_PROFILE_TEXT_LIMITS.targetCountryOrRegion,
  );
  if (targetCountryOrRegion) {
    profile.targetCountryOrRegion = targetCountryOrRegion;
  }

  const primaryConcern = sanitizeOptionalProfileText(
    source.primaryConcern,
    AI_CUSTOMER_PROFILE_TEXT_LIMITS.primaryConcern,
  );
  if (primaryConcern) profile.primaryConcern = primaryConcern;

  return Object.keys(profile).length > 0 ? profile : undefined;
}

/**
 * Re-sanitize an existing profile slice before provider send.
 * Defensive: same rules as build; never invents values.
 */
export function sanitizeCustomerInsightProfileForProvider(
  profile: CustomerInsightProfile | undefined,
): CustomerInsightProfile | undefined {
  if (!profile) return undefined;
  return buildCustomerInsightProfile(profile);
}

/** Stable object for hashing — fixed key order, omit when empty. */
export function customerInsightProfileForHash(
  profile: CustomerInsightProfile | undefined,
): CustomerInsightProfile | undefined {
  const sanitized = sanitizeCustomerInsightProfileForProvider(profile);
  if (!sanitized) return undefined;

  const ordered: CustomerInsightProfile = {};
  for (const key of CUSTOMER_INSIGHT_PROFILE_KEYS) {
    const value = sanitized[key];
    if (value !== undefined) {
      ordered[key] = value;
    }
  }
  return Object.keys(ordered).length > 0 ? ordered : undefined;
}
