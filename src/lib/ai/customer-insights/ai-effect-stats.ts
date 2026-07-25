/**
 * Phase 5D-4 Admin AI Effect Stats service.
 * Historical refresh metrics from audit_logs; feedback from ai_insight_feedback.
 * Never joins customer_ai_insights as historical truth. No PII in response.
 */

import { and, gte, inArray, lt } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { buildAiEffectRate } from "@/lib/ai/customer-insights/ai-effect-stats-rate";
import {
  classifyRefreshFailure,
  isAllowlistedComponentTag,
  isAllowlistedLegacyTag,
  normalizeActorRole,
  normalizeContractMode,
  normalizeDegradationReason,
  normalizePhase2Outcome,
  normalizeProviderKind,
  parseJsonObject,
  resolvePhase2Eligible,
  sanitizeDimensionString,
  type AiEffectActorRole,
  type AiEffectContractMode,
  type AiEffectProviderKind,
} from "@/lib/ai/customer-insights/ai-effect-stats-normalize";
import type {
  AiEffectStatsFilters,
  ParsedAiEffectStatsRequest,
} from "@/lib/ai/customer-insights/ai-effect-stats-request";
import {
  emptyAiEffectStatsResponse,
  type AiEffectCodeCount,
  type AiEffectStatsResponse,
  type AiEffectTargetFeedbackStats,
} from "@/lib/ai/customer-insights/ai-effect-stats-response";
import {
  AI_INSIGHT_FEEDBACK_BASE_DEEP_NEGATIVE_TAGS,
  AI_INSIGHT_FEEDBACK_BASE_DEEP_POSITIVE_TAGS,
  AI_INSIGHT_FEEDBACK_PHASE2_NEGATIVE_TAGS,
  AI_INSIGHT_FEEDBACK_PHASE2_POSITIVE_TAGS,
  AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_NEGATIVE_TAGS,
  AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_POSITIVE_TAGS,
} from "@/lib/ai/customer-insights/feedback-contract";
import { resolveAiProviderPhase2ContractMode } from "@/lib/ai/customer-insights/provider-contract-mode";
import { parseReasonTagsFromJson } from "@/lib/ai/customer-insights/feedback-stats-parse";

export const AI_EFFECT_STATS_REFRESH_ACTIONS = [
  "customer.ai_insight.refreshed",
  "customer.ai_insight.refresh_failed",
] as const;

/** Soft safety bound — if exceeded, fail closed rather than silently truncate. */
export const AI_EFFECT_STATS_AUDIT_HARD_LIMIT = 25_000;
export const AI_EFFECT_STATS_FEEDBACK_HARD_LIMIT = 25_000;

export class AiEffectStatsDataLimitError extends Error {
  readonly status = 503;
  readonly code = "AI_EFFECT_STATS_DATA_LIMIT_EXCEEDED";

  constructor(message = "AI effect stats data limit exceeded") {
    super(message);
    this.name = "AiEffectStatsDataLimitError";
  }
}

/** Detect overflow using LIMIT hardLimit+1 rows (never silently truncate). */
export function assertWithinHardLimit(
  rowCount: number,
  hardLimit: number,
): void {
  if (rowCount > hardLimit) {
    throw new AiEffectStatsDataLimitError();
  }
}

export type AiEffectStatsQueryMeter = {
  count: number;
};

function bump(meter?: AiEffectStatsQueryMeter) {
  if (meter) meter.count += 1;
}

type RefreshEvent = {
  action: string;
  entityId: string | null;
  userId: string | null;
  createdAt: string;
  meta: Record<string, unknown> | null;
  malformed: boolean;
};

function topCodeCounts(
  counts: Map<string, number>,
  limit = 10,
): AiEffectCodeCount[] {
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, limit);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function parseTagArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const tag of parsed) {
      if (typeof tag === "string" && tag && !out.includes(tag)) out.push(tag);
    }
    return out;
  } catch {
    return [];
  }
}

function resolveEventContractMode(
  meta: Record<string, unknown> | null,
  provider: AiEffectProviderKind,
): AiEffectContractMode {
  if (!meta) return "unknown";
  if ("contractMode" in meta) {
    return normalizeContractMode(meta.contractMode);
  }
  if (provider === "unknown") return "unknown";
  return resolveAiProviderPhase2ContractMode(provider);
}

function matchesCommonFilters(
  filters: AiEffectStatsFilters,
  dims: {
    provider: AiEffectProviderKind;
    model: string | null;
    promptVersion: string | null;
    contractMode: AiEffectContractMode;
    actorRole: AiEffectActorRole;
    phase2Generated: boolean | "unknown";
  },
): boolean {
  if (filters.provider !== "all" && dims.provider !== filters.provider) {
    return false;
  }
  if (filters.model != null && dims.model !== filters.model) return false;
  if (
    filters.promptVersion != null &&
    dims.promptVersion !== filters.promptVersion
  ) {
    return false;
  }
  if (
    filters.contractMode !== "all" &&
    dims.contractMode !== filters.contractMode
  ) {
    return false;
  }
  if (filters.actorRole !== "all" && dims.actorRole !== filters.actorRole) {
    return false;
  }
  if (filters.phase2Generated !== "all") {
    if (filters.phase2Generated === "unknown") {
      if (dims.phase2Generated !== "unknown") return false;
    } else if (filters.phase2Generated === "true") {
      if (dims.phase2Generated !== true) return false;
    } else if (dims.phase2Generated !== false) {
      return false;
    }
  }
  return true;
}

function finalizeTarget(
  submitted: number,
  helpful: number,
  notHelpful: number,
  positive: Map<string, number>,
  negative: Map<string, number>,
): AiEffectTargetFeedbackStats {
  return {
    submittedCount: submitted,
    helpfulCount: helpful,
    notHelpfulCount: notHelpful,
    helpfulRate: buildAiEffectRate(helpful, helpful + notHelpful),
    positiveTags: topCodeCounts(positive),
    negativeTags: topCodeCounts(negative),
  };
}

const POSITIVE_BY_TARGET: Record<string, ReadonlySet<string>> = {
  base_deep: new Set(AI_INSIGHT_FEEDBACK_BASE_DEEP_POSITIVE_TAGS),
  phase2: new Set(AI_INSIGHT_FEEDBACK_PHASE2_POSITIVE_TAGS),
  suggested_message: new Set(
    AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_POSITIVE_TAGS,
  ),
};

const NEGATIVE_BY_TARGET: Record<string, ReadonlySet<string>> = {
  base_deep: new Set(AI_INSIGHT_FEEDBACK_BASE_DEEP_NEGATIVE_TAGS),
  phase2: new Set(AI_INSIGHT_FEEDBACK_PHASE2_NEGATIVE_TAGS),
  suggested_message: new Set(
    AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_NEGATIVE_TAGS,
  ),
};

async function loadRefreshEvents(
  db: Database,
  from: string,
  to: string,
  meter?: AiEffectStatsQueryMeter,
): Promise<RefreshEvent[]> {
  bump(meter);
  const rows = await db
    .select({
      action: schema.auditLogs.action,
      entityId: schema.auditLogs.entityId,
      userId: schema.auditLogs.userId,
      createdAt: schema.auditLogs.createdAt,
      metadata: schema.auditLogs.metadata,
    })
    .from(schema.auditLogs)
    .where(
      and(
        inArray(schema.auditLogs.action, [...AI_EFFECT_STATS_REFRESH_ACTIONS]),
        gte(schema.auditLogs.createdAt, from),
        lt(schema.auditLogs.createdAt, to),
      ),
    )
    .limit(AI_EFFECT_STATS_AUDIT_HARD_LIMIT + 1);

  assertWithinHardLimit(rows.length, AI_EFFECT_STATS_AUDIT_HARD_LIMIT);

  return rows.map((row) => {
    const meta = parseJsonObject(row.metadata);
    return {
      action: row.action,
      entityId: row.entityId,
      userId: row.userId,
      createdAt: row.createdAt,
      meta,
      malformed: row.metadata != null && row.metadata !== "" && meta == null,
    };
  });
}

async function loadFeedbackRows(
  db: Database,
  from: string,
  to: string,
  meter?: AiEffectStatsQueryMeter,
) {
  bump(meter);
  const rows = await db
    .select({
      feedbackTarget: schema.aiInsightFeedback.feedbackTarget,
      rating: schema.aiInsightFeedback.rating,
      ratingCode: schema.aiInsightFeedback.ratingCode,
      reasonTagsJson: schema.aiInsightFeedback.reasonTagsJson,
      createdBy: schema.aiInsightFeedback.createdBy,
      generationKey: schema.aiInsightFeedback.generationKey,
      providerSnapshot: schema.aiInsightFeedback.providerSnapshot,
      model: schema.aiInsightFeedback.model,
      promptVersion: schema.aiInsightFeedback.promptVersion,
      contractModeSnapshot: schema.aiInsightFeedback.contractModeSnapshot,
      phase2GeneratedSnapshot: schema.aiInsightFeedback.phase2GeneratedSnapshot,
      actorRoleSnapshot: schema.aiInsightFeedback.actorRoleSnapshot,
      createdAt: schema.aiInsightFeedback.createdAt,
    })
    .from(schema.aiInsightFeedback)
    .where(
      and(
        gte(schema.aiInsightFeedback.createdAt, from),
        lt(schema.aiInsightFeedback.createdAt, to),
      ),
    )
    .limit(AI_EFFECT_STATS_FEEDBACK_HARD_LIMIT + 1);

  assertWithinHardLimit(rows.length, AI_EFFECT_STATS_FEEDBACK_HARD_LIMIT);
  return rows;
}

export async function getAiEffectStats(
  db: Database,
  parsed: ParsedAiEffectStatsRequest,
  options?: { queryMeter?: AiEffectStatsQueryMeter },
): Promise<AiEffectStatsResponse> {
  const meter = options?.queryMeter;
  const response = emptyAiEffectStatsResponse(parsed);
  const { filters, range } = parsed;

  const refreshEvents = await loadRefreshEvents(
    db,
    range.from,
    range.to,
    meter,
  );
  const feedbackRows = await loadFeedbackRows(db, range.from, range.to, meter);

  const providers = new Set<string>();
  const models = new Set<string>();
  const promptVersions = new Set<string>();
  const contractModes = new Set<string>();

  const customers = new Set<string>();
  const actors = new Set<string>();
  const degradation = new Map<string, number>();

  let completed = 0;
  let baseReady = 0;
  let failed = 0;
  let providerFailures = 0;
  let nonProviderFailures = 0;
  let unknownFailures = 0;

  for (const event of refreshEvents) {
    if (event.malformed) {
      response.dataQuality.malformedAuditMetadataEvents += 1;
    }

    const meta = event.meta;
    const provider = normalizeProviderKind(meta?.providerKind);
    const contractMode = resolveEventContractMode(meta, provider);
    const actorRole = normalizeActorRole(meta?.actorRole);
    const model = sanitizeDimensionString(meta?.model);
    const promptVersion = sanitizeDimensionString(meta?.promptVersion);

    let phase2Generated: boolean | "unknown" = "unknown";
    if (typeof meta?.phase2Generated === "boolean") {
      phase2Generated = meta.phase2Generated;
    } else if (
      typeof meta?.phase2Generated === "number" &&
      (meta.phase2Generated === 0 || meta.phase2Generated === 1)
    ) {
      phase2Generated = meta.phase2Generated === 1;
    }

    const isLegacySparse =
      provider === "unknown" ||
      contractMode === "unknown" ||
      actorRole === "unknown" ||
      (event.action === "customer.ai_insight.refreshed" &&
        phase2Generated === "unknown");
    if (isLegacySparse) {
      response.dataQuality.legacyRefreshEvents += 1;
    }
    if (provider === "unknown") {
      response.dataQuality.unknownProviderEvents += 1;
    }
    if (contractMode === "unknown") {
      response.dataQuality.unknownContractEvents += 1;
    }
    if (actorRole === "unknown") {
      response.dataQuality.unknownActorRoleEvents += 1;
    }

    if (
      !matchesCommonFilters(filters, {
        provider,
        model,
        promptVersion,
        contractMode,
        actorRole,
        phase2Generated,
      })
    ) {
      continue;
    }

    completed += 1;
    if (event.entityId) customers.add(event.entityId);
    if (event.userId) actors.add(event.userId);
    response.overview.byActorRole[actorRole] += 1;

    providers.add(provider);
    if (model) models.add(model);
    if (promptVersion) promptVersions.add(promptVersion);
    contractModes.add(contractMode);

    if (event.action === "customer.ai_insight.refreshed") {
      const finalStatus = meta?.finalStatus ?? meta?.status;
      const isReady =
        finalStatus === "ready" ||
        finalStatus == null ||
        finalStatus === undefined;
      if (isReady) {
        baseReady += 1;
      }

      const eligible = resolvePhase2Eligible(
        contractMode,
        meta?.phase2Eligible,
      );
      if (eligible === null) {
        response.phase2.unknownEligibility += 1;
        response.dataQuality.unknownPhase2OutcomeEvents += 1;
      } else if (eligible === false) {
        if (isReady) response.phase2.ineligibleReady += 1;
      } else if (isReady) {
        response.phase2.eligibleReady += 1;
        const outcome = normalizePhase2Outcome({
          contractMode,
          phase2Eligible: true,
          phase2Generated:
            phase2Generated === "unknown" ? undefined : phase2Generated,
        });
        if (outcome === "generated") {
          response.phase2.generated += 1;
        } else if (outcome === "safe_degraded") {
          response.phase2.safeDegraded += 1;
          const reason = normalizeDegradationReason(
            meta?.phase2UnavailableReason,
          );
          degradation.set(reason, (degradation.get(reason) ?? 0) + 1);
        } else {
          response.phase2.unknownOutcome += 1;
          response.dataQuality.unknownPhase2OutcomeEvents += 1;
        }
      }
    } else if (event.action === "customer.ai_insight.refresh_failed") {
      failed += 1;
      const category = classifyRefreshFailure({
        failureStage: meta?.failureStage,
        providerErrorType: meta?.providerErrorType,
        httpStatus: meta?.httpStatus,
        errorCode: meta?.errorCode,
      });
      if (category === "provider") providerFailures += 1;
      else if (category === "non_provider") nonProviderFailures += 1;
      else unknownFailures += 1;
    }
  }

  response.overview.completedAttempts = completed;
  response.overview.baseReady = baseReady;
  response.overview.failed = failed;
  response.overview.baseSuccessRate = buildAiEffectRate(baseReady, completed);
  response.overview.refreshFailureRate = buildAiEffectRate(failed, completed);
  response.overview.uniqueCustomers = customers.size;
  response.overview.uniqueActors = actors.size;
  response.failures = {
    provider: providerFailures,
    nonProvider: nonProviderFailures,
    unknownStage: unknownFailures,
  };

  const knownPhase2 =
    response.phase2.generated + response.phase2.safeDegraded;
  response.phase2.generationRate = buildAiEffectRate(
    response.phase2.generated,
    knownPhase2,
  );
  response.phase2.safeDegradationRate = buildAiEffectRate(
    response.phase2.safeDegraded,
    knownPhase2,
  );
  response.phase2.degradationReasons = topCodeCounts(degradation);

  const feedbackActors = new Set<string>();
  const feedbackGenerations = new Set<string>();
  const targetState: Record<
    string,
    {
      submitted: number;
      helpful: number;
      notHelpful: number;
      positive: Map<string, number>;
      negative: Map<string, number>;
    }
  > = {
    base_deep: {
      submitted: 0,
      helpful: 0,
      notHelpful: 0,
      positive: new Map(),
      negative: new Map(),
    },
    phase2: {
      submitted: 0,
      helpful: 0,
      notHelpful: 0,
      positive: new Map(),
      negative: new Map(),
    },
    suggested_message: {
      submitted: 0,
      helpful: 0,
      notHelpful: 0,
      positive: new Map(),
      negative: new Map(),
    },
  };

  let legacySubmitted = 0;
  let legacySum = 0;
  let legacyHelpful = 0;
  let legacyNeutral = 0;
  let legacyNotHelpful = 0;
  const legacyTags = new Map<string, number>();

  for (const row of feedbackRows) {
    const target = row.feedbackTarget ?? "legacy_overall";
    const isComponent =
      target === "base_deep" ||
      target === "phase2" ||
      target === "suggested_message";
    const isLegacy = target === "legacy_overall" && row.rating != null;

    if (!isComponent && !isLegacy) continue;

    if (filters.feedbackTarget !== "all") {
      if (filters.feedbackTarget === "legacy_overall") {
        if (!isLegacy) continue;
      } else if (target !== filters.feedbackTarget) {
        continue;
      }
    }

    const provider = normalizeProviderKind(row.providerSnapshot);
    const contractMode = normalizeContractMode(
      row.contractModeSnapshot ?? (isLegacy ? "unknown" : undefined),
    );
    const actorRole = normalizeActorRole(
      row.actorRoleSnapshot ?? (isLegacy ? "unknown" : undefined),
    );
    const model = sanitizeDimensionString(row.model);
    const promptVersion = sanitizeDimensionString(row.promptVersion);
    let phase2Generated: boolean | "unknown" = "unknown";
    if (typeof row.phase2GeneratedSnapshot === "boolean") {
      phase2Generated = row.phase2GeneratedSnapshot;
    }

    if (
      !matchesCommonFilters(filters, {
        provider,
        model,
        promptVersion,
        contractMode,
        actorRole,
        phase2Generated,
      })
    ) {
      continue;
    }

    if (model) models.add(model);
    if (promptVersion) promptVersions.add(promptVersion);
    if (isComponent) {
      providers.add(provider);
      contractModes.add(contractMode);
    }

    if (isComponent) {
      const bucket = targetState[target];
      bucket.submitted += 1;
      if (row.createdBy) feedbackActors.add(row.createdBy);
      if (row.generationKey) feedbackGenerations.add(row.generationKey);

      if (row.ratingCode === "helpful") bucket.helpful += 1;
      else if (row.ratingCode === "not_helpful") bucket.notHelpful += 1;

      const tags = parseTagArray(row.reasonTagsJson);
      let invalid = false;
      for (const tag of tags) {
        if (!isAllowlistedComponentTag(tag)) {
          invalid = true;
          continue;
        }
        if (
          row.ratingCode === "helpful" &&
          POSITIVE_BY_TARGET[target]?.has(tag)
        ) {
          bucket.positive.set(tag, (bucket.positive.get(tag) ?? 0) + 1);
        } else if (
          row.ratingCode === "not_helpful" &&
          NEGATIVE_BY_TARGET[target]?.has(tag)
        ) {
          bucket.negative.set(tag, (bucket.negative.get(tag) ?? 0) + 1);
        }
      }
      if (invalid) response.dataQuality.invalidTagRows += 1;
    } else {
      const rating = row.rating as number;
      legacySubmitted += 1;
      legacySum += rating;
      if (rating >= 4) legacyHelpful += 1;
      else if (rating === 3) legacyNeutral += 1;
      else if (rating <= 2) legacyNotHelpful += 1;
      if (row.createdBy) feedbackActors.add(row.createdBy);

      const legacyParsed = parseReasonTagsFromJson(row.reasonTagsJson ?? "[]");
      const rawTags = parseTagArray(row.reasonTagsJson);
      if (rawTags.some((tag) => !isAllowlistedLegacyTag(tag))) {
        response.dataQuality.invalidTagRows += 1;
      }
      for (const tag of legacyParsed) {
        legacyTags.set(tag, (legacyTags.get(tag) ?? 0) + 1);
      }
    }
  }

  response.feedback.submitted =
    targetState.base_deep.submitted +
    targetState.phase2.submitted +
    targetState.suggested_message.submitted;
  response.feedback.uniqueActors = feedbackActors.size;
  response.feedback.uniqueGenerations = feedbackGenerations.size;
  response.feedback.byTarget = {
    baseDeep: finalizeTarget(
      targetState.base_deep.submitted,
      targetState.base_deep.helpful,
      targetState.base_deep.notHelpful,
      targetState.base_deep.positive,
      targetState.base_deep.negative,
    ),
    phase2: finalizeTarget(
      targetState.phase2.submitted,
      targetState.phase2.helpful,
      targetState.phase2.notHelpful,
      targetState.phase2.positive,
      targetState.phase2.negative,
    ),
    suggestedMessage: finalizeTarget(
      targetState.suggested_message.submitted,
      targetState.suggested_message.helpful,
      targetState.suggested_message.notHelpful,
      targetState.suggested_message.positive,
      targetState.suggested_message.negative,
    ),
  };

  response.legacyFeedback = {
    submittedCount: legacySubmitted,
    averageRating:
      legacySubmitted === 0
        ? null
        : Math.round((legacySum / legacySubmitted) * 10) / 10,
    helpfulCount: legacyHelpful,
    neutralCount: legacyNeutral,
    notHelpfulCount: legacyNotHelpful,
    tagCounts: topCodeCounts(legacyTags),
  };

  response.dimensions = {
    providers: sortedUnique(providers),
    models: sortedUnique(models),
    promptVersions: sortedUnique(promptVersions),
    contractModes: sortedUnique(contractModes),
  };

  return response;
}
