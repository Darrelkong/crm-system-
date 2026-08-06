import { count, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  adminStageDistributionWhere,
  staffStageDistributionWhere,
} from "./dashboard-customer-scopes";
import { buildCustomersListQuery } from "@/lib/customers/queries";
import {
  aggregateRawStageCounts,
  buildStageDistributionRows,
} from "./dashboard-stage-catalog";
import type { DashboardStageDistributionPayload } from "./dashboard-stage-distribution-types";
import type { User } from "../../../drizzle/schema/users";

function buildStageDrilldownHref(stageKey: string): string {
  return `/customers${buildCustomersListQuery({ salesStage: stageKey })}`;
}

async function loadStageCounts(
  db: Database,
  scope: SQL,
): Promise<Array<{ stage: string | null; count: number }>> {
  const rows = await db
    .select({
      stage: schema.customers.salesStage,
      count: count().mapWith(Number),
    })
    .from(schema.customers)
    .where(scope)
    .groupBy(schema.customers.salesStage);

  return rows.map((row) => ({
    stage: row.stage,
    count: Number(row.count ?? 0),
  }));
}

export async function countAdminPrivateActiveCustomers(
  db: Database,
): Promise<number> {
  const row = await db
    .select({ value: count().mapWith(Number) })
    .from(schema.customers)
    .where(adminStageDistributionWhere());
  return Number(row[0]?.value ?? 0);
}

export async function getDashboardStageDistribution(
  db: Database,
  user: User,
): Promise<DashboardStageDistributionPayload> {
  const scope =
    user.role === "admin"
      ? adminStageDistributionWhere()
      : staffStageDistributionWhere(user.id);
  const rawRows = await loadStageCounts(db, scope);
  const { countsByBucket, totalCustomers } = aggregateRawStageCounts(rawRows);

  return {
    role: user.role === "admin" ? "admin" : "staff",
    titleKey:
      user.role === "admin"
        ? "dashboard.teamStageDistribution"
        : "dashboard.myStageDistribution",
    totalCustomers,
    stages: buildStageDistributionRows({
      countsByBucket,
      totalCustomers,
      buildHref: buildStageDrilldownHref,
    }),
  };
}
