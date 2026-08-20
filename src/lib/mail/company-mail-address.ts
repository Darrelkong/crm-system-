import { MailServiceError } from "@/lib/mail/errors";
import { normalizeMailEmailAddress } from "@/lib/mail/normalize-email-address";

/** Frozen ECHFRONT company mail domain for management writes. */
export const ECHFRONT_MAIL_DOMAIN = "echfronthk.com";

/**
 * Frozen reserved local-parts for generic mailbox/address management.
 * These may be managed by a future dedicated company/system-address flow.
 */
export const RESERVED_ECHFRONT_MAIL_LOCAL_PARTS = [
  "admin",
  "security",
  "billing",
  "postmaster",
  "abuse",
  "support",
  "service",
  "info",
  "finance",
  "hr",
  "noreply",
] as const;

const RESERVED_LOCAL_PART_SET = new Set<string>(
  RESERVED_ECHFRONT_MAIL_LOCAL_PARTS,
);

/**
 * Normalizes then validates an ECHFRONT company management mail address.
 * Rejects non-company domains, malformed addresses, and reserved local-parts.
 */
export function assertValidEchfrontMailAddress(
  value: string,
  options?: { allowReservedLocalPart?: boolean },
): string {
  let normalized: string;
  try {
    normalized = normalizeMailEmailAddress(value);
  } catch (error) {
    throw MailServiceError.validation(
      error instanceof Error ? error.message : "Invalid address",
    );
  }

  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0) {
    throw MailServiceError.validation("Invalid company mail address");
  }

  const localPart = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);

  if (localPart.length === 0) {
    throw MailServiceError.validation("Invalid company mail address");
  }

  if (domain !== ECHFRONT_MAIL_DOMAIN) {
    throw MailServiceError.validation("Mail address must use @echfronthk.com");
  }

  if (
    !options?.allowReservedLocalPart &&
    RESERVED_LOCAL_PART_SET.has(localPart)
  ) {
    throw MailServiceError.validation("This address is reserved");
  }

  return normalized;
}

export function isReservedEchfrontMailLocalPart(localPart: string): boolean {
  return RESERVED_LOCAL_PART_SET.has(localPart.toLowerCase());
}

/** Normalizes @echfronthk.com address without reserved-local-part enforcement. */
export function normalizeEchfrontCompanyAddress(value: string): {
  normalized: string;
  localPart: string;
} {
  let normalized: string;
  try {
    normalized = normalizeMailEmailAddress(value);
  } catch (error) {
    throw MailServiceError.validation(
      error instanceof Error ? error.message : "Invalid address",
    );
  }

  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0) {
    throw MailServiceError.validation("Invalid company mail address");
  }

  const localPart = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);

  if (localPart.length === 0) {
    throw MailServiceError.validation("Invalid company mail address");
  }

  if (domain !== ECHFRONT_MAIL_DOMAIN) {
    throw MailServiceError.validation("Mail address must use @echfronthk.com");
  }

  return { normalized, localPart };
}
