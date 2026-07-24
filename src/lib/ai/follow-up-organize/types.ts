export const FOLLOW_UP_ORGANIZE_SOURCE_BASIC = "basic_rules" as const;
export const FOLLOW_UP_ORGANIZE_SOURCE_AI = "external_ai" as const;
export const FOLLOW_UP_ORGANIZE_SOURCE_MOCK = "mock" as const;

export type FollowUpOrganizeSource =
  | typeof FOLLOW_UP_ORGANIZE_SOURCE_BASIC
  | typeof FOLLOW_UP_ORGANIZE_SOURCE_AI
  | typeof FOLLOW_UP_ORGANIZE_SOURCE_MOCK;

export type FollowUpOrganizeMode = "basic" | "ai";

export type FollowUpOrganizeWarningCode =
  | "TEXT_TOO_SHORT"
  | "NEXT_ACTION_MISSING"
  | "AMBIGUOUS_DATE"
  | "POSSIBLE_FACT_ADDED"
  | "INPUT_EMPTY"
  | "INPUT_TOO_LONG";

export type FollowUpOrganizeWarning = {
  code: FollowUpOrganizeWarningCode;
  messageKey: string;
};

export type FollowUpOrganizeExtracted = {
  businessNeed: string | null;
  concerns: string[];
  documentStatus: string[];
  agreedFollowUpAt: {
    rawText: string;
    isoCandidate: string | null;
  } | null;
  nextAction: string | null;
};

export type FollowUpOrganizationResult = {
  source: FollowUpOrganizeSource;
  originalText: string;
  organizedText: string;
  extracted: FollowUpOrganizeExtracted;
  warnings: FollowUpOrganizeWarning[];
  generatedAt: string;
};

export type FollowUpOrganizeAvailability = {
  canUseBasic: boolean;
  canUseAi: boolean;
  reason:
    | "AVAILABLE"
    | "GLOBAL_DISABLED"
    | "STAFF_DISABLED"
    | "LIMIT_REACHED"
    | "PROVIDER_UNAVAILABLE"
    | "MOCK_ONLY"
    | "PERMISSION_DENIED";
  remaining: number | null;
  dailyLimit: number;
};

/** Organize input floor — independent of follow-up save min length. */
export const FOLLOW_UP_ORGANIZE_MIN_LENGTH = 5;

/** Conservative max — follow-up summary has no DB max; Quick Entry notes max is 2000. */
export const FOLLOW_UP_ORGANIZE_MAX_LENGTH = 5000;

export function emptyExtracted(): FollowUpOrganizeExtracted {
  return {
    businessNeed: null,
    concerns: [],
    documentStatus: [],
    agreedFollowUpAt: null,
    nextAction: null,
  };
}
