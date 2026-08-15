import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { RECLAMATION_AUDIT_ACTIONS } from "@/lib/reclamation/constants";
import {
  getCustomerTagLabelMap,
  resolveCustomerTagLabel,
} from "@/lib/customer-tags/queries";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { computeScoringSummaryForAdmin } from "@/lib/customers/scoring/service";
import { recordAdminDashboardSettingsPhysicalLoad } from "./admin-dashboard-request-instrumentation";
import {
  getBusinessMonthRange,
  getBusinessTodayRange,
} from "./dates";
import type {
  AdminDashboardStats,
  CreatorNewCustomerCount,
} from "./types";
import type { EffectiveSettings } from "@/lib/settings/effective";
import type { SharedAdminDashboardKpis } from "./admin-dashboard-shared-kpis";
import {
  countAdminDashboardPendingApprovals,
  countAdminDashboardTotalCustomers,
} from "./admin-dashboard-shared-kpis";

export type AdminDashboardStatsRequestOptions = {
  settings?: EffectiveSettings;
  sharedKpis?: SharedAdminDashboardKpis;
};

function sortCreatorNewCustomerRows(
  rows: CreatorNewCustomerCount[],
): CreatorNewCustomerCount[] {
  return [...rows].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.isFormer !== b.isFormer) return a.isFormer ? 1 : -1;
    return a.displayName.localeCompare(b.displayName, "zh-Hant");
  });
}

export async function getAdminDashboardStats(
  db: Database,
  now: Date = new Date(),
  requestOptions?: AdminDashboardStatsRequestOptions,
): Promise<AdminDashboardStats> {
  let settings: EffectiveSettings;
  if (requestOptions?.settings) {
    settings = requestOptions.settings;
  } else {
    recordAdminDashboardSettingsPhysicalLoad();
    settings = await getEffectiveSettings(db);
  }
  const timezone = settings.businessTimezone;
  const { start: monthStart, endExclusive: monthEndExclusive } =
    getBusinessMonthRange(now, timezone);
  const nowIso = now.toISOString();
  const { end: todayEnd } = getBusinessTodayRange(
    now,
    timezone,
  );
  const tomorrowStart = new Date(new Date(todayEnd).getTime() + 1).toISOString();

  const [
    totalCustomers,
    pendingApprovals,
    activeCustomersRow,
    publicPoolRow,
    archivedRow,
    todayTasksRow,
    overdueTasksRow,
    followUpsRow,
    validFollowUpsRow,
    closedWonRow,
    autoReclaimedRow,
  ] = await Promise.all([
    requestOptions?.sharedKpis
      ? Promise.resolve(requestOptions.sharedKpis.totalCustomers)
      : countAdminDashboardTotalCustomers(db),
    requestOptions?.sharedKpis
      ? Promise.resolve(requestOptions.sharedKpis.pendingApprovals)
      : countAdminDashboardPendingApprovals(db),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(eq(schema.customers.status, "active")),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(eq(schema.customers.status, "public_pool")),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(eq(schema.customers.status, "archived")),
    db
      .select({ value: count() })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.status, "open"),
          isNotNull(schema.tasks.dueAt),
          gte(schema.tasks.dueAt, nowIso),
          lt(schema.tasks.dueAt, tomorrowStart),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.status, "open"),
          isNotNull(schema.tasks.dueAt),
          lt(schema.tasks.dueAt, nowIso),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.followUps)
      .where(
        and(
          gte(schema.followUps.followUpTime, monthStart),
          lt(schema.followUps.followUpTime, monthEndExclusive),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.followUps)
      .where(
        and(
          gte(schema.followUps.followUpTime, monthStart),
          lt(schema.followUps.followUpTime, monthEndExclusive),
          eq(schema.followUps.isValidFollowUp, 1),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.salesStage, "closed_won"),
          ne(schema.customers.status, "archived"),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.auditLogs)
      .where(
        and(
          eq(
            schema.auditLogs.action,
            RECLAMATION_AUDIT_ACTIONS.reclaimed,
          ),
          gte(schema.auditLogs.createdAt, monthStart),
          lt(schema.auditLogs.createdAt, monthEndExclusive),
        ),
      ),
  ]);

  const sourceRows = await db
    .select({
      label: schema.customers.source,
      count: count(),
    })
    .from(schema.customers)
    .where(ne(schema.customers.status, "archived"))
    .groupBy(schema.customers.source)
    .orderBy(desc(count()));

  const tagLabelMap = await getCustomerTagLabelMap(db);

  const stageRows = await db
    .select({
      label: schema.customers.salesStage,
      count: count(),
    })
    .from(schema.customers)
    .where(ne(schema.customers.status, "archived"))
    .groupBy(schema.customers.salesStage)
    .orderBy(desc(count()));

  const ownerRows = await db
    .select({
      ownerId: schema.customers.ownerId,
      ownerName: schema.users.displayName,
      count: count(),
    })
    .from(schema.customers)
    .innerJoin(schema.users, eq(schema.customers.ownerId, schema.users.id))
    .where(
      and(
        eq(schema.customers.status, "active"),
        isNotNull(schema.customers.ownerId),
      ),
    )
    .groupBy(schema.customers.ownerId, schema.users.displayName)
    .orderBy(desc(count()));

  const followUpStaffRows = await db
    .select({
      userId: schema.followUps.userId,
      userName: schema.users.displayName,
      count: count(),
    })
    .from(schema.followUps)
    .innerJoin(schema.users, eq(schema.followUps.userId, schema.users.id))
    .where(
      and(
        gte(schema.followUps.followUpTime, monthStart),
        lt(schema.followUps.followUpTime, monthEndExclusive),
      ),
    )
    .groupBy(schema.followUps.userId, schema.users.displayName)
    .orderBy(desc(count()));

  // Users as base so zero-count creators (incl. former staff) still appear.
  const creatorMonthRows = await db
    .select({
      userId: schema.users.id,
      displayName: schema.users.displayName,
      role: schema.users.role,
      deletedAt: schema.users.deletedAt,
      count: sql<number>`count(${schema.customers.id})`.mapWith(Number),
    })
    .from(schema.users)
    .leftJoin(
      schema.customers,
      and(
        eq(schema.customers.createdBy, schema.users.id),
        gte(schema.customers.createdAt, monthStart),
        lt(schema.customers.createdAt, monthEndExclusive),
        isNull(schema.customers.deletedAt),
      ),
    )
    .groupBy(
      schema.users.id,
      schema.users.displayName,
      schema.users.role,
      schema.users.deletedAt,
    )
    .orderBy(asc(schema.users.displayName));

  const newCustomersByCreatorThisMonth = sortCreatorNewCustomerRows(
    creatorMonthRows.map((row) => ({
      userId: row.userId,
      displayName: row.displayName,
      role: row.role,
      isFormer: row.deletedAt != null,
      count: Number(row.count ?? 0),
    })),
  );

  // Derive company total from the same creator breakdown so KPI and per-person
  // rows cannot diverge from a second concurrent count query.
  const newCustomersThisMonth = newCustomersByCreatorThisMonth.reduce(
    (sum, row) => sum + row.count,
    0,
  );

  // Pass `settings` to avoid a second getEffectiveSettings DB round-trip.
  const scoringSummary = await computeScoringSummaryForAdmin(db, now, settings);

  return {
    totalCustomers,
    activeCustomers: activeCustomersRow[0]?.value ?? 0,
    publicPoolCustomers: publicPoolRow[0]?.value ?? 0,
    archivedCustomers: archivedRow[0]?.value ?? 0,
    todayOpenTasks: todayTasksRow[0]?.value ?? 0,
    overdueTasks: overdueTasksRow[0]?.value ?? 0,
    pendingApprovals,
    newCustomersThisMonth,
    followUpsThisMonth: followUpsRow[0]?.value ?? 0,
    validFollowUpsThisMonth: validFollowUpsRow[0]?.value ?? 0,
    closedWonCustomers: closedWonRow[0]?.value ?? 0,
    autoReclaimedThisMonth: autoReclaimedRow[0]?.value ?? 0,
    highChurnRiskCustomers: scoringSummary.highChurnRiskCustomers,
    lowCompletenessCustomers: scoringSummary.lowCompletenessCustomers,
    customersBySource: sourceRows.map((r) => ({
      label: resolveCustomerTagLabel(r.label, tagLabelMap),
      count: r.count,
    })),
    customersBySalesStage: stageRows.map((r) => ({
      label: r.label,
      count: r.count,
    })),
    customersByOwner: ownerRows
      .filter((r) => r.ownerId)
      .map((r) => ({
        ownerId: r.ownerId!,
        ownerName: r.ownerName,
        count: r.count,
      })),
    followUpsByStaffThisMonth: followUpStaffRows.map((r) => ({
      userId: r.userId,
      userName: r.userName,
      count: r.count,
    })),
    newCustomersByCreatorThisMonth,
  };
}
