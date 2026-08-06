import {
  isSalesStage,
  LEGACY_SALES_STAGES,
  SALES_STAGES,
} from "@/lib/constants/customer-fields";

/** Filter / distribution bucket for customers without a meaningful stage. */
export const STAGE_DIST_NOT_SET = "__not_set__" as const;

/** Aggregated bucket for unknown custom stage values. */
export const STAGE_DIST_OTHER = "__other__" as const;

export type StageDistributionCatalogEntry = {
  key: string;
  order: number;
  labelKey: string;
  badgeKey: string;
  drillable: boolean;
};

const CATALOG_KEYS: string[] = [
  ...SALES_STAGES,
  ...LEGACY_SALES_STAGES.filter(
    (legacy) => !(SALES_STAGES as readonly string[]).includes(legacy),
  ),
  STAGE_DIST_NOT_SET,
  STAGE_DIST_OTHER,
];

export function getStageDistributionCatalog(): StageDistributionCatalogEntry[] {
  return CATALOG_KEYS.map((key, index) => ({
    key,
    order: index,
    labelKey:
      key === STAGE_DIST_NOT_SET
        ? "dashboard.stageNotSet"
        : key === STAGE_DIST_OTHER
          ? "dashboard.stageOther"
          : `salesStages.${key}`,
    badgeKey:
      key === STAGE_DIST_NOT_SET || key === STAGE_DIST_OTHER
        ? key
        : key,
    drillable:
      key !== STAGE_DIST_OTHER &&
      (key === STAGE_DIST_NOT_SET || isSalesStage(key)),
  }));
}

export function bucketRawSalesStage(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return STAGE_DIST_NOT_SET;
  }
  if ((SALES_STAGES as readonly string[]).includes(trimmed)) {
    return trimmed;
  }
  if ((LEGACY_SALES_STAGES as readonly string[]).includes(trimmed)) {
    return trimmed;
  }
  return STAGE_DIST_OTHER;
}

export function isKnownStageDistributionKey(key: string): boolean {
  return CATALOG_KEYS.includes(key);
}

export function computeStagePercentage(
  count: number,
  total: number,
): number {
  if (total <= 0 || count <= 0) {
    return 0;
  }
  return Math.round((count / total) * 1000) / 10;
}

export type StageCountRow = {
  key: string;
  labelKey: string;
  count: number;
  percentage: number;
  order: number;
  tone: string;
  href?: string;
};

export function buildStageDistributionRows(options: {
  countsByBucket: Map<string, number>;
  totalCustomers: number;
  buildHref?: (stageKey: string) => string | undefined;
}): StageCountRow[] {
  const catalog = getStageDistributionCatalog();
  const rows: StageCountRow[] = [];

  for (const entry of catalog) {
    const count = options.countsByBucket.get(entry.key) ?? 0;
    rows.push({
      key: entry.key,
      labelKey: entry.labelKey,
      count,
      percentage: computeStagePercentage(count, options.totalCustomers),
      order: entry.order,
      tone: entry.badgeKey,
      href:
        entry.drillable && count > 0
          ? options.buildHref?.(entry.key)
          : undefined,
    });
  }

  return rows;
}

export function aggregateRawStageCounts(
  rawRows: Array<{ stage: string | null; count: number }>,
): { countsByBucket: Map<string, number>; totalCustomers: number } {
  const countsByBucket = new Map<string, number>();
  let totalCustomers = 0;

  for (const row of rawRows) {
    const bucket = bucketRawSalesStage(row.stage);
    const value = Number(row.count ?? 0);
    totalCustomers += value;
    countsByBucket.set(bucket, (countsByBucket.get(bucket) ?? 0) + value);
  }

  return { countsByBucket, totalCustomers };
}
