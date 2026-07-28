/**
 * Central contact normalization for duplicate detection.
 * Does not mutate stored display values — comparison keys only.
 */

export type ContactIdentifierType = "phone" | "wechatId" | "email";

const FULLWIDTH_PARENS = /[（）]/g;
const HALFWIDTH_PARENS = /[()]/g;
const PHONE_SEPARATORS = /[\s\-]/g;

/** Digits only (ASCII). */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Normalize country code to `+` + digits, or null if empty / no digits.
 * Does not invent a country code.
 */
export function normalizePhoneCountryCode(
  countryCode: string | null | undefined,
): string | null {
  if (countryCode == null) return null;
  const trimmed = String(countryCode).trim();
  if (!trimmed) return null;
  const digits = digitsOnly(trimmed);
  if (!digits) return null;
  return `+${digits}`;
}

/**
 * National phone number: trim, strip spaces / parens / hyphens → digits only.
 * Does not strip meaningful leading zeros beyond non-digit removal
 * (leading zeros in digit strings are kept if present as digits — none for CN mobiles).
 */
export function normalizePhoneNationalNumber(
  phone: string | null | undefined,
): string | null {
  if (phone == null) return null;
  let s = String(phone).trim();
  if (!s) return null;
  s = s
    .replace(FULLWIDTH_PARENS, "")
    .replace(HALFWIDTH_PARENS, "")
    .replace(PHONE_SEPARATORS, "");
  const digits = digitsOnly(s);
  return digits || null;
}

/**
 * Stable phone identity: `+{ccDigits}{nationalDigits}` e.g. `+8613800138000`.
 * Requires both country code and national number with digits.
 * Different country codes with the same national digits are different identities.
 */
export function normalizeCustomerPhone(
  countryCode: string | null | undefined,
  phone: string | null | undefined,
): string | null {
  const cc = normalizePhoneCountryCode(countryCode);
  const national = normalizePhoneNationalNumber(phone);
  if (!cc || !national) return null;
  return `${cc}${national}`;
}

/**
 * WeChat ID comparison key: trim + lowercase.
 * Preserves hyphens, underscores, and digits in the underlying string
 * (case folding only).
 */
export function normalizeCustomerWechat(
  wechatId: string | null | undefined,
): string | null {
  if (wechatId == null) return null;
  const trimmed = String(wechatId).trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

/**
 * Email comparison key: trim + lowercase.
 * No Gmail-dot or +alias special cases.
 */
export function normalizeCustomerEmail(
  email: string | null | undefined,
): string | null {
  if (email == null) return null;
  const trimmed = String(email).trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

export function normalizeContactIdentifier(
  type: ContactIdentifierType,
  value: string | null | undefined,
  countryCode?: string | null,
): string | null {
  if (type === "phone") {
    return normalizeCustomerPhone(countryCode, value);
  }
  if (type === "wechatId") {
    return normalizeCustomerWechat(value);
  }
  return normalizeCustomerEmail(value);
}
