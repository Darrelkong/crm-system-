/**
 * Production Mail email-address normalization.
 * Semantics: trim → Unicode NFC → lowercase entire address.
 * No Gmail dot removal, plus stripping, or provider-specific transforms.
 */
export class MailEmailNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailEmailNormalizationError";
  }
}

export function normalizeMailEmailAddress(value: string): string {
  if (typeof value !== "string") {
    throw new MailEmailNormalizationError("Address must be a string");
  }
  const normalized = value.trim().normalize("NFC").toLowerCase();
  if (normalized.length === 0) {
    throw new MailEmailNormalizationError("Address must not be blank");
  }
  return normalized;
}

export function tryNormalizeMailEmailAddress(
  value: string,
): { ok: true; address: string } | { ok: false; message: string } {
  try {
    return { ok: true, address: normalizeMailEmailAddress(value) };
  } catch (error) {
    const message =
      error instanceof MailEmailNormalizationError
        ? error.message
        : "Invalid address";
    return { ok: false, message };
  }
}
