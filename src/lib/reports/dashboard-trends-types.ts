import type { DailyPoint } from "./dashboard-trends-period";

export const STAFF_TREND_METRIC_KEYS = [
  "valid_follow_ups",
  "new_customers",
  "claimed_from_pool",
  "released_to_pool",
] as const;

export const ADMIN_TREND_METRIC_KEYS = [
  "new_customers",
  "valid_follow_ups",
  "entered_negotiation",
  "closed_won",
  "released_to_pool",
  "claimed_from_pool",
] as const;

export type StaffTrendMetricKey = (typeof STAFF_TREND_METRIC_KEYS)[number];
export type AdminTrendMetricKey = (typeof ADMIN_TREND_METRIC_KEYS)[number];
export type DashboardTrendMetricKey =
  | StaffTrendMetricKey
  | AdminTrendMetricKey;

export type DashboardTrendMetricMeta = {
  key: DashboardTrendMetricKey;
  labelKey: string;
  /** How to interpret an increase for display tone. */
  increaseTone: "positive" | "negative" | "neutral";
};

export type DashboardTrendsPayload = {
  role: "admin" | "staff";
  timezone: "Asia/Hong_Kong";
  defaultMetricKey: DashboardTrendMetricKey;
  availableMetrics: DashboardTrendMetricMeta[];
  /** Unavailable metrics omitted from UI; listed for documentation/tests. */
  unavailableMetricKeys: string[];
  /** Full daily series (oldest → newest), typically 180 HK days. */
  dailySeries: Record<string, DailyPoint[]>;
};

export const STAFF_TREND_METRICS: DashboardTrendMetricMeta[] = [
  {
    key: "valid_follow_ups",
    labelKey: "dashboard.trendMetricValidFollowUps",
    increaseTone: "positive",
  },
  {
    key: "new_customers",
    labelKey: "dashboard.trendMetricNewCustomers",
    increaseTone: "positive",
  },
  {
    key: "claimed_from_pool",
    labelKey: "dashboard.trendMetricClaimedFromPool",
    increaseTone: "neutral",
  },
  {
    key: "released_to_pool",
    labelKey: "dashboard.trendMetricReleasedToPool",
    increaseTone: "negative",
  },
];

export const ADMIN_TREND_METRICS: DashboardTrendMetricMeta[] = [
  {
    key: "new_customers",
    labelKey: "dashboard.trendMetricNewCustomers",
    increaseTone: "positive",
  },
  {
    key: "valid_follow_ups",
    labelKey: "dashboard.trendMetricValidFollowUps",
    increaseTone: "positive",
  },
  {
    key: "entered_negotiation",
    labelKey: "dashboard.trendMetricEnteredNegotiation",
    increaseTone: "positive",
  },
  {
    key: "closed_won",
    labelKey: "dashboard.trendMetricClosedWon",
    increaseTone: "positive",
  },
  {
    key: "released_to_pool",
    labelKey: "dashboard.trendMetricReleasedToPool",
    increaseTone: "negative",
  },
  {
    key: "claimed_from_pool",
    labelKey: "dashboard.trendMetricClaimedFromPool",
    increaseTone: "neutral",
  },
];

export const UNAVAILABLE_TREND_METRICS = [
  "pending_second_conversion",
] as const;
