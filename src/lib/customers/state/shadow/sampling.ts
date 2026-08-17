/** Deterministic FNV-1a hash for stable ~5% request sampling. */
export function hashShadowSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** ~5% of requests when `hash(seed) % 100 < 5`. */
export function isShadowSampleRequest(seed: string): boolean {
  return hashShadowSeed(seed) % 100 < 5;
}
