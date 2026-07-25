/**
 * Rate helper for Phase 5D-4 Admin AI Effect Stats.
 * value is 0..1 with at most 4 decimal places; never NaN/Infinity/percent string.
 */

export type AiEffectRate = {
  numerator: number;
  denominator: number;
  value: number | null;
};

export class AiEffectRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiEffectRateError";
  }
}

export function buildAiEffectRate(
  numerator: number,
  denominator: number,
): AiEffectRate {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    throw new AiEffectRateError("Rate inputs must be finite numbers");
  }
  if (numerator < 0 || denominator < 0) {
    throw new AiEffectRateError("Rate inputs must be non-negative");
  }

  const n = Math.trunc(numerator);
  const d = Math.trunc(denominator);

  if (d === 0) {
    return { numerator: n, denominator: 0, value: null };
  }

  if (n > d) {
    throw new AiEffectRateError("Numerator cannot exceed denominator");
  }

  const raw = n / d;
  const value = Math.round(raw * 10000) / 10000;

  return {
    numerator: n,
    denominator: d,
    value,
  };
}
