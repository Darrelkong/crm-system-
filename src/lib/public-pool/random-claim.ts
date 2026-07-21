/**
 * Server-only helpers for public-pool random claim candidate ordering.
 * Not wired to any Route in RANDOM-CLAIM-1.
 */

export type RandomIndexSource = (upperExclusive: number) => number;

/** Uint32 sample space size used by crypto.getRandomValues(Uint32Array). */
export const UINT32_RANGE = 0x1_0000_0000; // 2^32

/**
 * Uniform integer in [0, upperExclusive).
 * Uses rejection sampling to avoid modulo bias when using crypto.getRandomValues.
 *
 * Supported: 1 <= upperExclusive <= 2^32.
 */
export function secureRandomIndex(
  upperExclusive: number,
  randomSource?: RandomIndexSource,
): number {
  if (
    !Number.isFinite(upperExclusive) ||
    !Number.isInteger(upperExclusive) ||
    upperExclusive <= 0
  ) {
    throw new RangeError(
      `upperExclusive must be a positive integer, got ${String(upperExclusive)}`,
    );
  }

  if (upperExclusive > UINT32_RANGE) {
    throw new RangeError(
      `upperExclusive must be <= ${UINT32_RANGE}, got ${String(upperExclusive)}`,
    );
  }

  if (upperExclusive === 1) {
    return 0;
  }

  if (randomSource) {
    const index = randomSource(upperExclusive);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= upperExclusive
    ) {
      throw new RangeError(
        `randomSource returned out-of-range index ${String(index)} for upperExclusive=${upperExclusive}`,
      );
    }
    return index;
  }

  const buf = new Uint32Array(1);

  // Full Uint32 domain: each sample is already uniform in [0, 2^32).
  if (upperExclusive === UINT32_RANGE) {
    crypto.getRandomValues(buf);
    return buf[0]!;
  }

  const limit = UINT32_RANGE - (UINT32_RANGE % upperExclusive);
  for (;;) {
    crypto.getRandomValues(buf);
    const value = buf[0]!;
    if (value < limit) {
      return value % upperExclusive;
    }
  }
}

/**
 * Fisher–Yates shuffle. Does not mutate the input array.
 * Production uses crypto.getRandomValues via secureRandomIndex.
 */
export function shuffleRandomClaimCandidates<T>(
  candidates: readonly T[],
  randomSource?: RandomIndexSource,
): T[] {
  const result = candidates.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = secureRandomIndex(i + 1, randomSource);
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

/** Alias: produce the attempt order for a later claim retry loop. */
export function createRandomClaimAttemptOrder<T>(
  candidates: readonly T[],
  randomSource?: RandomIndexSource,
): T[] {
  return shuffleRandomClaimCandidates(candidates, randomSource);
}
