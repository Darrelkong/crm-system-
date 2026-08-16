/**
 * Text-presence semantics for Customer State Engine V2.
 *
 * Authority: TASK 17-B-R1 RULE G-3 — emptiness is "null or, after trimming
 * ECMAScript whitespace, zero-length", matching the `sqlFieldHasText` helper
 * proven in TASK 16B2 so the future SQL mirror agrees exactly.
 *
 * Consequences that MUST hold (verified by TASK 16B2 parity fixtures):
 * - U+00A0, U+3000, U+FEFF and the rest of the ECMAScript WhiteSpace +
 *   LineTerminator set are trimmed.
 * - U+0000 is NOT whitespace, so "\u0000" is present text.
 */
export function hasStateText(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

/** Count of distinct non-empty values among the supplied fields. */
export function countPresent(
  ...values: readonly (string | null | undefined)[]
): number {
  let count = 0;
  for (const value of values) {
    if (hasStateText(value)) count += 1;
  }
  return count;
}

export function anyPresent(
  ...values: readonly (string | null | undefined)[]
): boolean {
  return countPresent(...values) > 0;
}
