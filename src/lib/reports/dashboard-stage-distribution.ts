import { and, count, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { ownedNormalCustomerListWhere } from "@/lib/customers/customer-list-filters";
import { buildCustomersListQuery } from "@/lib/customers/queries";
import {
  aggregateRawStageCounts,
  buildStageDistributionRows,
} from "./dashboard-stage-catalog";
import type { DashboardStageDistributionPayload } from "./dashboard-stage-distribution-types";
import type { User } from "../../../drizzle/schema/users";

function activeOwnedPrivateWhere(extra?: SQL): SQL {
  const base = and(
    eq(schema.customers.status, "active"),
    isNull(schema.customers.deletedAt),
    isNotNull(schema.customers.ownerId),
  )!;
  return extra ? and(base, extra)! : base;
}

function staffStageScope(userId: string): SQL {
  return and(ownedNormalCustomerListWhere(userId), activeOwnedPrivateWhere())!;
}

function adminTeamStageScope(): SQL {
  return and(
    activeOwnedPrivateWhere(),
    sql`EXISTS (
      SELECT 1 FROM ${schema.users} u
      WHERE u.id = ${schema.customers.ownerId}
        AND u.role = 'staff'
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    )`,
  )!;
}

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

export async function getDashboardStageDistribution(
  db: Database,
  user: User,
): Promise<DashboardStageDistributionPayload> {
  const scope =
    user.role === "admin" ? adminTeamStageScope() : staffStageScope(user.id);
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
