export const HEAT_LEVELS = [
  "high",
  "medium",
  "low",
  "silent",
  "high_churn_risk",
] as const;

export type HeatLevel = (typeof HEAT_LEVELS)[number];

export type HeatReasonPart = {
  key: string;
  params?: Record<string, string>;
};

import type { ReclamationCountdownDisplay } from "@/lib/reclamation/countdown-display";

export type CustomerScores = {
  heatLevel: HeatLevel;
  completenessScore: number;
  heatReasonKeys?: HeatReasonPart[];
  completenessMissingFields?: string[];
  /** Server-computed auto-release countdown for list badges; null = hidden. */
  reclamationCountdown?: ReclamationCountdownDisplay | null;
};

export type ScoringContext = {
  hasFollowUp: boolean;
};
