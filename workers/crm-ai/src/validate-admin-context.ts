import {
  ADMIN_BRIEF_MAX_STAGE_BUCKETS,
} from "./admin-brief";

const ALLOWED_TOP_KEYS = new Set([
  "metrics",
  "teamAggregates",
  "reclamationRisk",
  "stageDistribution",
  "trendSummary",
]);

const METRICS_KEYS = new Set([
  "newCustomersToday",
  "validFollowUpsToday",
  "pendingApprovals",
  "autoReleaseWithin7Days",
  "autoReleaseTomorrow",
  "overdueFollowUps",
  "publicPoolEnteredToday",
  "totalCustomers",
]);

const TEAM_KEYS = new Set([
  "activeStaffCount",
  "staffWithOverdueCount",
  "staffWithReclamationRiskCount",
  "teamPendingItemsTotal",
  "teamCurrentCustomersTotal",
]);

const RECLAMATION_KEYS = new Set([
  "tomorrowCount",
  "within7Count",
  "membersAtRiskCount",
  "pendingRiskCount",
]);

const TREND_KEYS = new Set([
  "validFollowUpsLast7Days",
  "newCustomersLast7Days",
  "stageProgressLast7Days",
]);

const EXPLICIT_FORBIDDEN_KEYS = new Set([
  "name",
  "email",
  "phone",
  "wechat",
  "address",
  "passport",
  "itin",
  "customerid",
  "userid",
  "viewerid",
  "sessionid",
  "staffid",
  "ownerid",
  "customername",
  "staffname",
  "staffemail",
]);

const ALLOWED_LOCALES = new Set(["zh-Hant", "zh-Hans", "en"]);

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value);
}

function hasOnlyKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function rejectForbiddenKeys(record: Record<string, unknown>): boolean {
  return Object.keys(record).some((key) => {
    const lower = key.toLowerCase();
    return EXPLICIT_FORBIDDEN_KEYS.has(lower) || lower.includes("uuid");
  });
}

function validateNumberObject(
  value: unknown,
  allowed: Set<string>,
): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!hasOnlyKeys(record, allowed) || rejectForbiddenKeys(record)) return false;
  return Object.values(record).every(isNonNegativeInt);
}

export type ValidatedAdminContext = {
  metrics: Record<string, number>;
  teamAggregates: Record<string, number>;
  reclamationRisk: Record<string, number>;
  trendSummary: Record<string, number>;
  stageDistribution: Array<{ stageKey: string; count: number; percentage: number }>;
};

export function validateAdminBriefLocale(locale: unknown): string | null {
  if (typeof locale !== "string") return null;
  return ALLOWED_LOCALES.has(locale) ? locale : null;
}

export function validateAdminBriefContext(
  context: unknown,
): ValidatedAdminContext | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return null;
  }

  const record = context as Record<string, unknown>;
  if (!hasOnlyKeys(record, ALLOWED_TOP_KEYS) || rejectForbiddenKeys(record)) {
    return null;
  }

  if (
    !validateNumberObject(record.metrics, METRICS_KEYS) ||
    !validateNumberObject(record.teamAggregates, TEAM_KEYS) ||
    !validateNumberObject(record.reclamationRisk, RECLAMATION_KEYS) ||
    !validateNumberObject(record.trendSummary, TREND_KEYS)
  ) {
    return null;
  }

  if (!Array.isArray(record.stageDistribution)) return null;
  if (record.stageDistribution.length > ADMIN_BRIEF_MAX_STAGE_BUCKETS) {
    return null;
  }

  const stageDistribution: ValidatedAdminContext["stageDistribution"] = [];
  for (const item of record.stageDistribution) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const bucket = item as Record<string, unknown>;
    if (
      rejectForbiddenKeys(bucket) ||
      typeof bucket.stageKey !== "string" ||
      bucket.stageKey.length === 0 ||
      bucket.stageKey.length > 64 ||
      !isNonNegativeInt(bucket.count) ||
      typeof bucket.percentage !== "number" ||
      !Number.isFinite(bucket.percentage) ||
      bucket.percentage < 0 ||
      bucket.percentage > 100
    ) {
      return null;
    }
    stageDistribution.push({
      stageKey: bucket.stageKey,
      count: bucket.count,
      percentage: bucket.percentage,
    });
  }

  return {
    metrics: record.metrics as Record<string, number>,
    teamAggregates: record.teamAggregates as Record<string, number>,
    reclamationRisk: record.reclamationRisk as Record<string, number>,
    trendSummary: record.trendSummary as Record<string, number>,
    stageDistribution,
  };
}
