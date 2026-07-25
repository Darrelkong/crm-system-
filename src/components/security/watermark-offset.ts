/**
 * Deterministic tile offset from a stable user identity string (id or email).
 * Same input always yields the same offset; safe for SSR/client parity.
 */
export function watermarkOffsetFromSeed(seed: string): {
  offsetX: number;
  offsetY: number;
} {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const positive = hash >>> 0;
  return {
    offsetX: positive % 41,
    offsetY: (positive >>> 8) % 31,
  };
}
