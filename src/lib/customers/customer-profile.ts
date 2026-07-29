/**
 * Customer profile Phase 1 — shared enums, normalize, and validation.
 * Contact preference is channel preference only (not a duplicate identifier).
 */

import type { ValidationFieldError } from "@/lib/customers/validation";

export const CUSTOMER_GENDERS = [
  "male",
  "female",
  "other",
  "prefer_not_to_say",
] as const;

export type CustomerGender = (typeof CUSTOMER_GENDERS)[number];

export const CUSTOMER_AGE_RANGES = [
  "under_25",
  "25_34",
  "35_44",
  "45_54",
  "55_64",
  "65_plus",
] as const;

export type CustomerAgeRange = (typeof CUSTOMER_AGE_RANGES)[number];

export const CUSTOMER_PREFERRED_LANGUAGES = [
  "zh_hant",
  "zh_hans",
  "en",
  "other",
] as const;

export type CustomerPreferredLanguage =
  (typeof CUSTOMER_PREFERRED_LANGUAGES)[number];

export const CUSTOMER_PREFERRED_CONTACT_METHODS = [
  "phone",
  "wechat",
  "email",
  "other",
] as const;

export type CustomerPreferredContactMethod =
  (typeof CUSTOMER_PREFERRED_CONTACT_METHODS)[number];

export const CUSTOMER_PROFILE_TEXT_LIMITS = {
  preferredName: 40,
  occupation: 60,
  companyName: 120,
  jobTitle: 80,
  targetCountryOrRegion: 80,
  primaryConcern: 200,
} as const;

/** CamelCase keys used in API / form / DTO. */
export const CUSTOMER_PROFILE_FIELD_KEYS = [
  "preferredName",
  "gender",
  "ageRange",
  "preferredLanguage",
  "preferredContactMethod",
  "occupation",
  "companyName",
  "jobTitle",
  "targetCountryOrRegion",
  "primaryConcern",
] as const;

export type CustomerProfileFieldKey =
  (typeof CUSTOMER_PROFILE_FIELD_KEYS)[number];

/** DB / audit field_name values. */
export const CUSTOMER_PROFILE_DB_FIELD_NAMES = [
  "preferred_name",
  "gender",
  "age_range",
  "preferred_language",
  "preferred_contact_method",
  "occupation",
  "company_name",
  "job_title",
  "target_country_or_region",
  "primary_concern",
] as const;

export type CustomerProfileDbFieldName =
  (typeof CUSTOMER_PROFILE_DB_FIELD_NAMES)[number];

export type CustomerProfileFields = {
  preferredName: string | null;
  gender: string | null;
  ageRange: string | null;
  preferredLanguage: string | null;
  preferredContactMethod: string | null;
  occupation: string | null;
  companyName: string | null;
  jobTitle: string | null;
  targetCountryOrRegion: string | null;
  primaryConcern: string | null;
};

/** Form / draft string shape (empty string = unset). */
export type CustomerProfileFormFields = {
  preferredName: string;
  gender: string;
  ageRange: string;
  preferredLanguage: string;
  preferredContactMethod: string;
  occupation: string;
  companyName: string;
  jobTitle: string;
  targetCountryOrRegion: string;
  primaryConcern: string;
};

export function createEmptyCustomerProfileFormFields(): CustomerProfileFormFields {
  return {
    preferredName: "",
    gender: "",
    ageRange: "",
    preferredLanguage: "",
    preferredContactMethod: "",
    occupation: "",
    companyName: "",
    jobTitle: "",
    targetCountryOrRegion: "",
    primaryConcern: "",
  };
}

export function isCustomerGender(value: string): value is CustomerGender {
  return (CUSTOMER_GENDERS as readonly string[]).includes(value);
}

export function isCustomerAgeRange(value: string): value is CustomerAgeRange {
  return (CUSTOMER_AGE_RANGES as readonly string[]).includes(value);
}

export function isCustomerPreferredLanguage(
  value: string,
): value is CustomerPreferredLanguage {
  return (CUSTOMER_PREFERRED_LANGUAGES as readonly string[]).includes(value);
}

export function isCustomerPreferredContactMethod(
  value: string,
): value is CustomerPreferredContactMethod {
  return (CUSTOMER_PREFERRED_CONTACT_METHODS as readonly string[]).includes(
    value,
  );
}

/** Blank / whitespace → null; otherwise trimmed string. */
export function normalizeOptionalProfileText(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeCustomerProfileFields(input: {
  preferredName?: string | null;
  gender?: string | null;
  ageRange?: string | null;
  preferredLanguage?: string | null;
  preferredContactMethod?: string | null;
  occupation?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  targetCountryOrRegion?: string | null;
  primaryConcern?: string | null;
}): CustomerProfileFields {
  return {
    preferredName: normalizeOptionalProfileText(input.preferredName),
    gender: normalizeOptionalProfileText(input.gender),
    ageRange: normalizeOptionalProfileText(input.ageRange),
    preferredLanguage: normalizeOptionalProfileText(input.preferredLanguage),
    preferredContactMethod: normalizeOptionalProfileText(
      input.preferredContactMethod,
    ),
    occupation: normalizeOptionalProfileText(input.occupation),
    companyName: normalizeOptionalProfileText(input.companyName),
    jobTitle: normalizeOptionalProfileText(input.jobTitle),
    targetCountryOrRegion: normalizeOptionalProfileText(
      input.targetCountryOrRegion,
    ),
    primaryConcern: normalizeOptionalProfileText(input.primaryConcern),
  };
}

export function profileFieldsToFormStrings(
  profile: CustomerProfileFields,
): CustomerProfileFormFields {
  return {
    preferredName: profile.preferredName ?? "",
    gender: profile.gender ?? "",
    ageRange: profile.ageRange ?? "",
    preferredLanguage: profile.preferredLanguage ?? "",
    preferredContactMethod: profile.preferredContactMethod ?? "",
    occupation: profile.occupation ?? "",
    companyName: profile.companyName ?? "",
    jobTitle: profile.jobTitle ?? "",
    targetCountryOrRegion: profile.targetCountryOrRegion ?? "",
    primaryConcern: profile.primaryConcern ?? "",
  };
}

export function customerHasAnyProfileValue(
  profile: Partial<CustomerProfileFields | CustomerProfileFormFields>,
): boolean {
  return CUSTOMER_PROFILE_FIELD_KEYS.some((key) => {
    const value = profile[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function pushTextLengthError(
  errors: ValidationFieldError[],
  field: CustomerProfileFieldKey,
  value: string | null,
  max: number,
  code: string,
): void {
  if (value != null && value.length > max) {
    errors.push({
      field,
      message: `该字段最多 ${max} 个字`,
      code,
    });
  }
}

function pushEnumError(
  errors: ValidationFieldError[],
  field: CustomerProfileFieldKey,
  value: string | null,
  isValid: (v: string) => boolean,
  code: string,
): void {
  if (value != null && !isValid(value)) {
    errors.push({
      field,
      message: "选项无效",
      code,
    });
  }
}

/** Shared create/update validation for profile fields (after normalize). */
export function validateCustomerProfileFields(
  profile: CustomerProfileFields,
): ValidationFieldError[] {
  const errors: ValidationFieldError[] = [];

  pushTextLengthError(
    errors,
    "preferredName",
    profile.preferredName,
    CUSTOMER_PROFILE_TEXT_LIMITS.preferredName,
    "PREFERRED_NAME_TOO_LONG",
  );
  pushEnumError(
    errors,
    "gender",
    profile.gender,
    isCustomerGender,
    "INVALID_GENDER",
  );
  pushEnumError(
    errors,
    "ageRange",
    profile.ageRange,
    isCustomerAgeRange,
    "INVALID_AGE_RANGE",
  );
  pushEnumError(
    errors,
    "preferredLanguage",
    profile.preferredLanguage,
    isCustomerPreferredLanguage,
    "INVALID_PREFERRED_LANGUAGE",
  );
  pushEnumError(
    errors,
    "preferredContactMethod",
    profile.preferredContactMethod,
    isCustomerPreferredContactMethod,
    "INVALID_PREFERRED_CONTACT_METHOD",
  );
  pushTextLengthError(
    errors,
    "occupation",
    profile.occupation,
    CUSTOMER_PROFILE_TEXT_LIMITS.occupation,
    "OCCUPATION_TOO_LONG",
  );
  pushTextLengthError(
    errors,
    "companyName",
    profile.companyName,
    CUSTOMER_PROFILE_TEXT_LIMITS.companyName,
    "COMPANY_NAME_TOO_LONG",
  );
  pushTextLengthError(
    errors,
    "jobTitle",
    profile.jobTitle,
    CUSTOMER_PROFILE_TEXT_LIMITS.jobTitle,
    "JOB_TITLE_TOO_LONG",
  );
  pushTextLengthError(
    errors,
    "targetCountryOrRegion",
    profile.targetCountryOrRegion,
    CUSTOMER_PROFILE_TEXT_LIMITS.targetCountryOrRegion,
    "TARGET_COUNTRY_OR_REGION_TOO_LONG",
  );
  pushTextLengthError(
    errors,
    "primaryConcern",
    profile.primaryConcern,
    CUSTOMER_PROFILE_TEXT_LIMITS.primaryConcern,
    "PRIMARY_CONCERN_TOO_LONG",
  );

  return errors;
}

/** Parse raw body fields into optional profile strings (pre-normalize). */
export function parseCustomerProfileBody(
  body: Record<string, unknown>,
): {
  preferredName: string | null;
  gender: string | null;
  ageRange: string | null;
  preferredLanguage: string | null;
  preferredContactMethod: string | null;
  occupation: string | null;
  companyName: string | null;
  jobTitle: string | null;
  targetCountryOrRegion: string | null;
  primaryConcern: string | null;
} {
  function asStringOrNull(value: unknown): string | null {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return null;
    return null;
  }

  return {
    preferredName: asStringOrNull(body.preferredName),
    gender: asStringOrNull(body.gender),
    ageRange: asStringOrNull(body.ageRange),
    preferredLanguage: asStringOrNull(body.preferredLanguage),
    preferredContactMethod: asStringOrNull(body.preferredContactMethod),
    occupation: asStringOrNull(body.occupation),
    companyName: asStringOrNull(body.companyName),
    jobTitle: asStringOrNull(body.jobTitle),
    targetCountryOrRegion: asStringOrNull(body.targetCountryOrRegion),
    primaryConcern: asStringOrNull(body.primaryConcern),
  };
}

const PROFILE_ENUM_I18N_PREFIX: Partial<
  Record<CustomerProfileDbFieldName, string>
> = {
  gender: "customerProfileEnums.gender",
  age_range: "customerProfileEnums.ageRange",
  preferred_language: "customerProfileEnums.preferredLanguage",
  preferred_contact_method: "customerProfileEnums.preferredContactMethod",
};

/** Resolve profile enum code → i18n key for timeline / detail. */
export function profileEnumLabelKey(
  dbFieldName: string,
  value: string,
): string | null {
  const prefix = PROFILE_ENUM_I18N_PREFIX[dbFieldName as CustomerProfileDbFieldName];
  if (!prefix) return null;
  return `${prefix}.${value}`;
}

export function isCustomerProfileDbFieldName(
  value: string,
): value is CustomerProfileDbFieldName {
  return (CUSTOMER_PROFILE_DB_FIELD_NAMES as readonly string[]).includes(value);
}
