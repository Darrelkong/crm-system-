/**
 * Canonical sales-stage normalization for Customer State Engine V2.
 *
 * Authority: TASK 17-B-R1 §S (RULE S-1..S-4).
 * Legacy aliases MUST be mapped before any threshold lookup. Values that exist
 * only in display/i18n layers are NOT stages and MUST NOT receive an SLA row.
 */

/** Stages that carry an active-sales cadence row. */
export const ACTIVE_SLA_STAGES = [
  "new_lead",
  "contacted",
  "interested",
  "proposal",
  "negotiation",
] as const;

export type ActiveSlaStage = (typeof ACTIVE_SLA_STAGES)[number];

/** Stages with special (non-cadence) handling. */
export const SPECIAL_STAGES = [
  "on_hold",
  "closed_won",
  "paid",
  "closed_lost",
] as const;

export type SpecialStage = (typeof SPECIAL_STAGES)[number];

export type CanonicalStage = ActiveSlaStage | SpecialStage;

export const CANONICAL_STAGES = [
  ...ACTIVE_SLA_STAGES,
  ...SPECIAL_STAGES,
] as const;

/** RULE S-2 — legacy stored values mapped to canonical equivalents. */
export const STAGE_ALIASES: Readonly<Record<string, CanonicalStage>> = {
  negotiating: "negotiation",
  converted: "closed_won",
  lost: "closed_lost",
};

/**
 * RULE S-3 — values found only in display/i18n layers. Listed so the engine
 * documents them explicitly rather than appearing to have overlooked them.
 * They resolve to `unknown`, never to a canonical stage.
 */
export const NON_STAGE_DISPLAY_VALUES = [
  "qualified",
  "invalid",
  "negotiation_reminder",
  "pending_second_conversion",
] as const;

export function isActiveSlaStage(value: string): value is ActiveSlaStage {
  return (ACTIVE_SLA_STAGES as readonly string[]).includes(value);
}

export function isCanonicalStage(value: string): value is CanonicalStage {
  return (CANONICAL_STAGES as readonly string[]).includes(value);
}

export type NormalizedStage =
  | { kind: "canonical"; stage: CanonicalStage; rawValue: string; aliased: boolean }
  | { kind: "unknown"; rawValue: string };

/**
 * Resolve a stored `sales_stage` value to its canonical form.
 * Unknown values MUST NOT fall back to another stage's thresholds (RULE S-4).
 */
export function normalizeSalesStage(rawValue: string | null | undefined): NormalizedStage {
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!raw) {
    return { kind: "unknown", rawValue: rawValue ?? "" };
  }
  if (isCanonicalStage(raw)) {
    return { kind: "canonical", stage: raw, rawValue: raw, aliased: false };
  }
  const alias = STAGE_ALIASES[raw];
  if (alias) {
    return { kind: "canonical", stage: alias, rawValue: raw, aliased: true };
  }
  return { kind: "unknown", rawValue: raw };
}
