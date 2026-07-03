import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  lt,
  lte,
  ne,
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
import {
  getBusinessMonthRange,
  getBusinessTodayRange,
} from "./dates";
import type { AdminDashboardStats } from "./types";

export async function getAdminDashboardStats(
  db: Database,
  now: Date = new Date(),
): Promise<AdminDashboardStats> {
  const settings = await getEffectiveSettings(db);
  const timezone = settings.businessTimezone;
  const { start: monthStart, endExclusive: monthEndExclusive } =
    getBusinessMonthRange(now, timezone);
  const nowIso = now.toISOString();
  const { start: todayStart, end: todayEnd } = getBusinessTodayRange(
    now,
    timezone,
  );

  const [
    totalCustomersRow,
    activeCustomersRow,
    publicPoolRow,
    archivedRow,
    todayTasksRow,
    overdueTasksRow,
    pendingApprovalsRow,
    newCustomersRow,
    followUpsRow,
    validFollowUpsRow,
    closedWonRow,
    autoReclaimedRow,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(ne(schema.customers.status, "archived")),
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
          gte(schema.tasks.dueAt, todayStart),
          lte(schema.tasks.dueAt, todayEnd),
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
      .from(schema.approvals)
      .where(eq(schema.approvals.status, "pending")),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(
        and(
          gte(schema.customers.createdAt, monthStart),
          lt(schema.customers.createdAt, monthEndExclusive),
          ne(schema.customers.status, "archived"),
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

  // Pass `settings` to avoid a second getEffectiveSettings DB round-trip.
  const scoringSummary = await computeScoringSummaryForAdmin(db, now, settings);

  return {
    totalCustomers: totalCustomersRow[0]?.value ?? 0,
    activeCustomers: activeCustomersRow[0]?.value ?? 0,
    publicPoolCustomers: publicPoolRow[0]?.value ?? 0,
    archivedCustomers: archivedRow[0]?.value ?? 0,
    todayOpenTasks: todayTasksRow[0]?.value ?? 0,
    overdueTasks: overdueTasksRow[0]?.value ?? 0,
    pendingApprovals: pendingApprovalsRow[0]?.value ?? 0,
    newCustomersThisMonth: newCustomersRow[0]?.value ?? 0,
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
  };
}
