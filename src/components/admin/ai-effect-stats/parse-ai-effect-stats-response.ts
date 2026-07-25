/**
 * Runtime client guard for GET /api/admin/ai-effect-stats responses.
 * Rejects malformed payloads entirely — never render partial bad data.
 * Rebuilds a safe object so unexpected / PII fields never enter UI state.
 */

export type AiEffectRateClient = {
  numerator: number;
  denominator: number;
  value: number | null;
};

export type AiEffectCodeCountClient = {
  code: string;
  count: number;
};

export type AiEffectTargetFeedbackClient = {
  submittedCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
  helpfulRate: AiEffectRateClient;
  positiveTags: AiEffectCodeCountClient[];
  negativeTags: AiEffectCodeCountClient[];
};

export type AiEffectStatsClientFiltersEcho = {
  provider: string;
  model: string | null;
  promptVersion: string | null;
  contractMode: string;
  actorRole: string;
  feedbackTarget: string;
  phase2Generated: string;
};

export type AiEffectStatsClientResponse = {
  ok: true;
  range: {
    days: number;
    from: string;
    to: string;
    timezone: string;
  };
  filters: AiEffectStatsClientFiltersEcho;
  filterScope: {
    common: string[];
    feedbackOnly: string[];
  };
  overview: {
    completedAttempts: number;
    baseReady: number;
    failed: number;
    baseSuccessRate: AiEffectRateClient;
    refreshFailureRate: AiEffectRateClient;
    uniqueCustomers: number;
    uniqueActors: number;
    byActorRole: {
      admin: number;
      staff: number;
      unknown: number;
    };
  };
  failures: {
    provider: number;
    nonProvider: number;
    unknownStage: number;
  };
  phase2: {
    eligibleReady: number;
    generated: number;
    safeDegraded: number;
    unknownOutcome: number;
    ineligibleReady: number;
    unknownEligibility: number;
    generationRate: AiEffectRateClient;
    safeDegradationRate: AiEffectRateClient;
    degradationReasons: AiEffectCodeCountClient[];
  };
  feedback: {
    submitted: number;
    uniqueActors: number;
    uniqueGenerations: number;
    coverageAvailable: false;
    coverageValue: null;
    coverageUnavailableReason: "actor_target_exposure_not_recorded";
    byTarget: {
      baseDeep: AiEffectTargetFeedbackClient;
      phase2: AiEffectTargetFeedbackClient;
      suggestedMessage: AiEffectTargetFeedbackClient;
    };
  };
  legacyFeedback: {
    submittedCount: number;
    averageRating: number | null;
    helpfulCount: number;
    neutralCount: number;
    notHelpfulCount: number;
    tagCounts: AiEffectCodeCountClient[];
  };
  dimensions: {
    providers: string[];
    models: string[];
    promptVersions: string[];
    contractModes: string[];
  };
  dataQuality: {
    legacyRefreshEvents: number;
    unknownProviderEvents: number;
    unknownContractEvents: number;
    unknownActorRoleEvents: number;
    unknownPhase2OutcomeEvents: number;
    invalidTagRows: number;
    malformedAuditMetadataEvents: number;
  };
};

export class AiEffectStatsParseError extends Error {
  constructor(message = "Malformed AI effect stats response") {
    super(message);
    this.name = "AiEffectStatsParseError";
  }
}

const MAX_DIMENSION_LENGTH = 100;
const MAX_CODE_LENGTH = 64;
const SAFE_CODE_RE = /^[a-z0-9_]{1,64}$/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function requireNonNegInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new AiEffectStatsParseError(`Invalid number: ${field}`);
  }
  return Math.trunc(value);
}

function parseRate(value: unknown, field: string): AiEffectRateClient {
  if (!isObject(value)) {
    throw new AiEffectStatsParseError(`Invalid rate: ${field}`);
  }
  const numerator = requireNonNegInt(value.numerator, `${field}.numerator`);
  const denominator = requireNonNegInt(
    value.denominator,
    `${field}.denominator`,
  );
  if (value.value !== null && typeof value.value !== "number") {
    throw new AiEffectStatsParseError(`Invalid rate value: ${field}`);
  }
  if (typeof value.value === "number") {
    if (!Number.isFinite(value.value) || value.value < 0 || value.value > 1) {
      throw new AiEffectStatsParseError(`Invalid rate value: ${field}`);
    }
  }
  if (denominator === 0) {
    if (value.value !== null) {
      throw new AiEffectStatsParseError(`Rate value must be null when denom=0`);
    }
  } else if (numerator > denominator) {
    throw new AiEffectStatsParseError(`Numerator exceeds denominator: ${field}`);
  }
  return {
    numerator,
    denominator,
    value: value.value === null ? null : value.value,
  };
}

function parseSafeCode(code: unknown, field: string): string {
  if (typeof code !== "string" || code.length === 0 || code.length > MAX_CODE_LENGTH) {
    throw new AiEffectStatsParseError(`Invalid code: ${field}`);
  }
  if (!SAFE_CODE_RE.test(code)) {
    throw new AiEffectStatsParseError(`Unsafe code: ${field}`);
  }
  return code;
}

function parseCodeCounts(
  value: unknown,
  field: string,
): AiEffectCodeCountClient[] {
  if (!Array.isArray(value)) {
    throw new AiEffectStatsParseError(`Invalid code counts: ${field}`);
  }
  if (value.length > 50) {
    throw new AiEffectStatsParseError(`Too many code rows: ${field}`);
  }
  return value.map((row, index) => {
    if (!isObject(row)) {
      throw new AiEffectStatsParseError(`Invalid code row: ${field}[${index}]`);
    }
    return {
      code: parseSafeCode(row.code, `${field}[${index}].code`),
      count: requireNonNegInt(row.count, `${field}[${index}].count`),
    };
  });
}

function parseTarget(
  value: unknown,
  field: string,
): AiEffectTargetFeedbackClient {
  if (!isObject(value)) {
    throw new AiEffectStatsParseError(`Invalid target: ${field}`);
  }
  return {
    submittedCount: requireNonNegInt(
      value.submittedCount,
      `${field}.submittedCount`,
    ),
    helpfulCount: requireNonNegInt(value.helpfulCount, `${field}.helpfulCount`),
    notHelpfulCount: requireNonNegInt(
      value.notHelpfulCount,
      `${field}.notHelpfulCount`,
    ),
    helpfulRate: parseRate(value.helpfulRate, `${field}.helpfulRate`),
    positiveTags: parseCodeCounts(value.positiveTags, `${field}.positiveTags`),
    negativeTags: parseCodeCounts(value.negativeTags, `${field}.negativeTags`),
  };
}

function parseDimensionString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AiEffectStatsParseError(`Invalid dimension: ${field}`);
  }
  if (value.length > MAX_DIMENSION_LENGTH || CONTROL_CHAR_RE.test(value)) {
    throw new AiEffectStatsParseError(`Unsafe dimension: ${field}`);
  }
  return value;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new AiEffectStatsParseError(`Invalid string array: ${field}`);
  }
  if (value.length > 200) {
    throw new AiEffectStatsParseError(`Too many dimensions: ${field}`);
  }
  return value.map((item, index) =>
    parseDimensionString(item, `${field}[${index}]`),
  );
}

function parseOptionalDimension(
  value: unknown,
  field: string,
): string | null {
  if (value === null) return null;
  return parseDimensionString(value, field);
}

function parseFiltersEcho(value: unknown): AiEffectStatsClientFiltersEcho {
  if (!isObject(value)) {
    throw new AiEffectStatsParseError("Invalid filters");
  }
  return {
    provider: typeof value.provider === "string" ? value.provider : "all",
    model: parseOptionalDimension(value.model ?? null, "filters.model"),
    promptVersion: parseOptionalDimension(
      value.promptVersion ?? null,
      "filters.promptVersion",
    ),
    contractMode:
      typeof value.contractMode === "string" ? value.contractMode : "all",
    actorRole: typeof value.actorRole === "string" ? value.actorRole : "all",
    feedbackTarget:
      typeof value.feedbackTarget === "string" ? value.feedbackTarget : "all",
    phase2Generated:
      typeof value.phase2Generated === "string"
        ? value.phase2Generated
        : "all",
  };
}

export function parseAiEffectStatsClientResponse(
  value: unknown,
): AiEffectStatsClientResponse {
  if (value == null || Array.isArray(value) || !isObject(value)) {
    throw new AiEffectStatsParseError("Response must be an object");
  }
  if (value.ok !== true) {
    throw new AiEffectStatsParseError("ok must be true");
  }

  const required = [
    "range",
    "filters",
    "filterScope",
    "overview",
    "failures",
    "phase2",
    "feedback",
    "legacyFeedback",
    "dimensions",
    "dataQuality",
  ] as const;
  for (const key of required) {
    if (!(key in value)) {
      throw new AiEffectStatsParseError(`Missing section: ${key}`);
    }
  }

  const range = value.range;
  const overview = value.overview;
  const failures = value.failures;
  const phase2 = value.phase2;
  const feedback = value.feedback;
  const legacy = value.legacyFeedback;
  const dimensions = value.dimensions;
  const dataQuality = value.dataQuality;
  const filterScope = value.filterScope;

  if (!isObject(range) || !isObject(overview) || !isObject(failures)) {
    throw new AiEffectStatsParseError("Invalid top-level sections");
  }
  if (!isObject(phase2) || !isObject(feedback) || !isObject(legacy)) {
    throw new AiEffectStatsParseError("Invalid top-level sections");
  }
  if (!isObject(dimensions) || !isObject(dataQuality)) {
    throw new AiEffectStatsParseError("Invalid top-level sections");
  }
  if (!isObject(filterScope)) {
    throw new AiEffectStatsParseError("Missing filterScope");
  }
  if (
    !Array.isArray(filterScope.common) ||
    !Array.isArray(filterScope.feedbackOnly)
  ) {
    throw new AiEffectStatsParseError("Invalid filterScope");
  }
  if (!isObject(feedback.byTarget)) {
    throw new AiEffectStatsParseError("Missing feedback.byTarget");
  }
  if (!isObject(overview.byActorRole)) {
    throw new AiEffectStatsParseError("Missing overview.byActorRole");
  }

  if (feedback.coverageAvailable !== false) {
    throw new AiEffectStatsParseError("coverageAvailable must be false");
  }
  if (feedback.coverageValue !== null) {
    throw new AiEffectStatsParseError("coverageValue must be null");
  }
  if (feedback.coverageUnavailableReason !== "actor_target_exposure_not_recorded") {
    throw new AiEffectStatsParseError("Invalid coverageUnavailableReason");
  }

  const averageRating = legacy.averageRating;
  if (
    averageRating !== null &&
    (typeof averageRating !== "number" ||
      !Number.isFinite(averageRating) ||
      averageRating < 0)
  ) {
    throw new AiEffectStatsParseError("Invalid legacy averageRating");
  }

  // Rebuild a whitelist object — never spread the raw response into UI state.
  return {
    ok: true,
    range: {
      days: requireNonNegInt(range.days, "range.days"),
      from: typeof range.from === "string" ? range.from.slice(0, 64) : "",
      to: typeof range.to === "string" ? range.to.slice(0, 64) : "",
      timezone:
        typeof range.timezone === "string" ? range.timezone.slice(0, 64) : "",
    },
    filters: parseFiltersEcho(value.filters),
    filterScope: {
      common: filterScope.common.filter((item) => typeof item === "string"),
      feedbackOnly: filterScope.feedbackOnly.filter(
        (item) => typeof item === "string",
      ),
    },
    overview: {
      completedAttempts: requireNonNegInt(
        overview.completedAttempts,
        "overview.completedAttempts",
      ),
      baseReady: requireNonNegInt(overview.baseReady, "overview.baseReady"),
      failed: requireNonNegInt(overview.failed, "overview.failed"),
      baseSuccessRate: parseRate(
        overview.baseSuccessRate,
        "overview.baseSuccessRate",
      ),
      refreshFailureRate: parseRate(
        overview.refreshFailureRate,
        "overview.refreshFailureRate",
      ),
      uniqueCustomers: requireNonNegInt(
        overview.uniqueCustomers,
        "overview.uniqueCustomers",
      ),
      uniqueActors: requireNonNegInt(
        overview.uniqueActors,
        "overview.uniqueActors",
      ),
      byActorRole: {
        admin: requireNonNegInt(
          overview.byActorRole.admin,
          "overview.byActorRole.admin",
        ),
        staff: requireNonNegInt(
          overview.byActorRole.staff,
          "overview.byActorRole.staff",
        ),
        unknown: requireNonNegInt(
          overview.byActorRole.unknown,
          "overview.byActorRole.unknown",
        ),
      },
    },
    failures: {
      provider: requireNonNegInt(failures.provider, "failures.provider"),
      nonProvider: requireNonNegInt(
        failures.nonProvider,
        "failures.nonProvider",
      ),
      unknownStage: requireNonNegInt(
        failures.unknownStage,
        "failures.unknownStage",
      ),
    },
    phase2: {
      eligibleReady: requireNonNegInt(
        phase2.eligibleReady,
        "phase2.eligibleReady",
      ),
      generated: requireNonNegInt(phase2.generated, "phase2.generated"),
      safeDegraded: requireNonNegInt(
        phase2.safeDegraded,
        "phase2.safeDegraded",
      ),
      unknownOutcome: requireNonNegInt(
        phase2.unknownOutcome,
        "phase2.unknownOutcome",
      ),
      ineligibleReady: requireNonNegInt(
        phase2.ineligibleReady,
        "phase2.ineligibleReady",
      ),
      unknownEligibility: requireNonNegInt(
        phase2.unknownEligibility,
        "phase2.unknownEligibility",
      ),
      generationRate: parseRate(phase2.generationRate, "phase2.generationRate"),
      safeDegradationRate: parseRate(
        phase2.safeDegradationRate,
        "phase2.safeDegradationRate",
      ),
      degradationReasons: parseCodeCounts(
        phase2.degradationReasons,
        "phase2.degradationReasons",
      ),
    },
    feedback: {
      submitted: requireNonNegInt(feedback.submitted, "feedback.submitted"),
      uniqueActors: requireNonNegInt(
        feedback.uniqueActors,
        "feedback.uniqueActors",
      ),
      uniqueGenerations: requireNonNegInt(
        feedback.uniqueGenerations,
        "feedback.uniqueGenerations",
      ),
      coverageAvailable: false,
      coverageValue: null,
      coverageUnavailableReason: "actor_target_exposure_not_recorded",
      byTarget: {
        baseDeep: parseTarget(feedback.byTarget.baseDeep, "byTarget.baseDeep"),
        phase2: parseTarget(feedback.byTarget.phase2, "byTarget.phase2"),
        suggestedMessage: parseTarget(
          feedback.byTarget.suggestedMessage,
          "byTarget.suggestedMessage",
        ),
      },
    },
    legacyFeedback: {
      submittedCount: requireNonNegInt(
        legacy.submittedCount,
        "legacy.submittedCount",
      ),
      averageRating,
      helpfulCount: requireNonNegInt(legacy.helpfulCount, "legacy.helpfulCount"),
      neutralCount: requireNonNegInt(legacy.neutralCount, "legacy.neutralCount"),
      notHelpfulCount: requireNonNegInt(
        legacy.notHelpfulCount,
        "legacy.notHelpfulCount",
      ),
      tagCounts: parseCodeCounts(legacy.tagCounts, "legacy.tagCounts"),
    },
    dimensions: {
      providers: parseStringArray(dimensions.providers, "dimensions.providers"),
      models: parseStringArray(dimensions.models, "dimensions.models"),
      promptVersions: parseStringArray(
        dimensions.promptVersions,
        "dimensions.promptVersions",
      ),
      contractModes: parseStringArray(
        dimensions.contractModes,
        "dimensions.contractModes",
      ),
    },
    dataQuality: {
      legacyRefreshEvents: requireNonNegInt(
        dataQuality.legacyRefreshEvents,
        "dataQuality.legacyRefreshEvents",
      ),
      unknownProviderEvents: requireNonNegInt(
        dataQuality.unknownProviderEvents,
        "dataQuality.unknownProviderEvents",
      ),
      unknownContractEvents: requireNonNegInt(
        dataQuality.unknownContractEvents,
        "dataQuality.unknownContractEvents",
      ),
      unknownActorRoleEvents: requireNonNegInt(
        dataQuality.unknownActorRoleEvents,
        "dataQuality.unknownActorRoleEvents",
      ),
      unknownPhase2OutcomeEvents: requireNonNegInt(
        dataQuality.unknownPhase2OutcomeEvents,
        "dataQuality.unknownPhase2OutcomeEvents",
      ),
      invalidTagRows: requireNonNegInt(
        dataQuality.invalidTagRows,
        "dataQuality.invalidTagRows",
      ),
      malformedAuditMetadataEvents: requireNonNegInt(
        dataQuality.malformedAuditMetadataEvents,
        "dataQuality.malformedAuditMetadataEvents",
      ),
    },
  };
}

export function dataQualityHasIssues(
  dataQuality: AiEffectStatsClientResponse["dataQuality"],
): boolean {
  return Object.values(dataQuality).some((count) => count > 0);
}
