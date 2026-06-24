export const HEAT_LEVELS = [
  "high",
  "medium",
  "low",
  "silent",
  "high_churn_risk",
] as const;

export type HeatLevel = (typeof HEAT_LEVELS)[number];

export type CustomerScores = {
  heatLevel: HeatLevel;
  completenessScore: number;
  heatReason?: string;
  completenessMissingFields?: string[];
};

export type ScoringContext = {
  hasFollowUp: boolean;
};
