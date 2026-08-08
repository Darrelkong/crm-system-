import { STAFF_ACTIONS_MAX_STAGE_BUCKETS } from "./staff-actions";

export const STAFF_MAX_CANDIDATES = 20;

const ALLOWED_TOP_KEYS = new Set([
  "metrics",
  "reclamationRisk",
  "stageDistribution",
  "trendSummary",
  "customers",
]);

const METRICS_KEYS = new Set([
  "dueTodayFollowUps",
  "overdueFollowUps",
  "autoReleaseWithin7Days",
  "autoReleaseTomorrow",
  "pendingWorkItems",
  "validFollowUpsToday",
  "myCustomerCount",
]);

const RECLAMATION_KEYS = new Set([
  "tomorrowCount",
  "within7Count",
  "pendingRiskCount",
]);

const TREND_KEYS = new Set([
  "validFollowUpsLast7Days",
  "newCustomersLast7Days",
]);

const CUSTOMER_KEYS = new Set([
  "ref",
  "stage",
  "followUpStatus",
  "overdueHours",
  "reclamationDaysRemaining",
  "pendingActions",
]);

const FOLLOW_UP_STATUSES = new Set([
  "due_today",
  "overdue",
  "scheduled",
  "none",
]);

const EXPLICIT_FORBIDDEN_KEYS = new Set([
  "name",
  "email",
  "phone",
  "mobile",
  "wechat",
  "address",
  "passport",
  "itin",
  "bank",
  "customerid",
  "userid",
  "viewerid",
  "sessionid",
  "staffid",
  "ownerid",
  "customername",
  "staffname",
  "staffemail",
  "displayname",
  "href",
  "url",
  "id",
]);

const ALLOWED_LOCALES = new Set(["zh-Hant", "zh-Hans", "en"]);
const CUSTOMER_REF_PATTERN = /^C\d+$/;

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

export type ValidatedStaffCustomer = {
  ref: string;
  stage: string | null;
  followUpStatus: string;
  overdueHours?: number;
  reclamationDaysRemaining?: number;
  pendingActions: string[];
};

export type ValidatedStaffContext = {
  metrics: Record<string, number>;
  reclamationRisk: Record<string, number>;
  trendSummary: Record<string, number>;
  stageDistribution: Array<{ stageKey: string; count: number; percentage: number }>;
  customers: ValidatedStaffCustomer[];
  allowedCustomerRefs: Set<string>;
};

export function validateStaffActionsLocale(locale: unknown): string | null {
  if (typeof locale !== "string") return null;
  return ALLOWED_LOCALES.has(locale) ? locale : null;
}

export function validateStaffActionsContext(
  context: unknown,
): ValidatedStaffContext | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return null;
  }

  const record = context as Record<string, unknown>;
  if (!hasOnlyKeys(record, ALLOWED_TOP_KEYS) || rejectForbiddenKeys(record)) {
    return null;
  }

  if (
    !validateNumberObject(record.metrics, METRICS_KEYS) ||
    !validateNumberObject(record.reclamationRisk, RECLAMATION_KEYS) ||
    !validateNumberObject(record.trendSummary, TREND_KEYS)
  ) {
    return null;
  }

  if (!Array.isArray(record.stageDistribution)) return null;
  if (record.stageDistribution.length > STAFF_ACTIONS_MAX_STAGE_BUCKETS) {
    return null;
  }

  const stageDistribution: ValidatedStaffContext["stageDistribution"] = [];
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

  if (!Array.isArray(record.customers)) return null;
  if (record.customers.length > STAFF_MAX_CANDIDATES) return null;

  const customers: ValidatedStaffCustomer[] = [];
  const allowedCustomerRefs = new Set<string>();
  const seenRefs = new Set<string>();

  for (const item of record.customers) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const customer = item as Record<string, unknown>;
    if (!hasOnlyKeys(customer, CUSTOMER_KEYS) || rejectForbiddenKeys(customer)) {
      return null;
    }
    if (
      typeof customer.ref !== "string" ||
      !CUSTOMER_REF_PATTERN.test(customer.ref) ||
      seenRefs.has(customer.ref)
    ) {
      return null;
    }
    if (
      customer.stage !== null &&
      (typeof customer.stage !== "string" ||
        customer.stage.length === 0 ||
        customer.stage.length > 64)
    ) {
      return null;
    }
    if (
      typeof customer.followUpStatus !== "string" ||
      !FOLLOW_UP_STATUSES.has(customer.followUpStatus)
    ) {
      return null;
    }
    if (
      customer.overdueHours !== undefined &&
      !isNonNegativeInt(customer.overdueHours)
    ) {
      return null;
    }
    if (
      customer.reclamationDaysRemaining !== undefined &&
      !isNonNegativeInt(customer.reclamationDaysRemaining)
    ) {
      return null;
    }
    if (!Array.isArray(customer.pendingActions)) return null;
    if (customer.pendingActions.length > 8) return null;

    const pendingActions: string[] = [];
    for (const action of customer.pendingActions) {
      if (
        typeof action !== "string" ||
        action.length === 0 ||
        action.length > 32 ||
        /https?:\/\//i.test(action)
      ) {
        return null;
      }
      pendingActions.push(action);
    }

    seenRefs.add(customer.ref);
    allowedCustomerRefs.add(customer.ref);
    customers.push({
      ref: customer.ref,
      stage: customer.stage as string | null,
      followUpStatus: customer.followUpStatus,
      overdueHours:
        customer.overdueHours === undefined
          ? undefined
          : customer.overdueHours,
      reclamationDaysRemaining:
        customer.reclamationDaysRemaining === undefined
          ? undefined
          : customer.reclamationDaysRemaining,
      pendingActions,
    });
  }

  return {
    metrics: record.metrics as Record<string, number>,
    reclamationRisk: record.reclamationRisk as Record<string, number>,
    trendSummary: record.trendSummary as Record<string, number>,
    stageDistribution,
    customers,
    allowedCustomerRefs,
  };
}
