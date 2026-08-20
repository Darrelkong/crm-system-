import { MAIL_RFC_MESSAGE_ID_DOMAIN } from "@/lib/mail/constants";

/**
 * V1 RFC Message-ID format (Phase 2C.7):
 *
 * `<{opaque-uuid}@{domain}>`
 *
 * - RFC 5322 Message-ID syntax
 * - Server-generated opaque UUID — not derived from subject/recipient/customer data
 * - Stable for one logical Send Operation lifetime (created at send initiation)
 * - Reused across every Transport retry for the same Send Operation
 */
export function generateRfcMessageId(
  domain: string = MAIL_RFC_MESSAGE_ID_DOMAIN,
): string {
  return `<${crypto.randomUUID()}@${domain}>`;
}

export function isValidRfcMessageIdFormat(value: string): boolean {
  return /^<[^@\s<>]+@[^@\s<>]+>$/.test(value);
}
