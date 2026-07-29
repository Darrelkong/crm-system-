/**
 * Match-key normalization for confirmed customer-name soft duplicate warnings.
 * Does not change persisted customerName values or create/confirm validation.
 */

import {
  isPendingNamePlaceholder,
} from "@/lib/customers/name-status";
import {
  countChineseCharacters,
  isValidCustomerName,
} from "@/lib/customers/validation";

const CONFIRM_DUPLICATE_NAME_MAX_LENGTH = 200;

/** Max length accepted for Create `confirmDuplicateName` request field. */
export { CONFIRM_DUPLICATE_NAME_MAX_LENGTH };

/**
 * Build a name-duplicate match key, or null when the name must not participate.
 * - pending placeholders → null
 * - blank / invalid → null
 * - Chinese (any CJK): NFC + exact string after trim
 * - otherwise (Latin): NFC + lowercase + collapse whitespace; keep - and '
 */
export function normalizeCustomerNameForDuplicateMatch(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (isPendingNamePlaceholder(trimmed)) return null;

  const nfc = trimmed.normalize("NFC");
  if (!nfc) return null;

  if (!isValidCustomerName(nfc)) return null;

  if (countChineseCharacters(nfc) > 0) {
    return nfc;
  }

  return nfc.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Parse optional Create confirm field. Returns the string only when usable for
 * exact comparison against a server match key; otherwise null (not confirmed).
 */
export function parseConfirmDuplicateName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value || value.length > CONFIRM_DUPLICATE_NAME_MAX_LENGTH) return null;
  return value;
}
