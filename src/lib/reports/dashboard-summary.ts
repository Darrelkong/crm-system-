import { and, count, eq, gte, isNotNull, isNull, lt, ne } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { ownedNormalCustomerListWhere } from "@/lib/customers/customer-list-filters";
import { normalCustomerListStatusWhere } from "@/lib/customers/customer-list-filters";
import { getPendingActionCount } from "@/lib/notifications/queries";
import { collectReclamationRiskSnapshots } from "@/lib/reclamation/work-items-sync";
import { aggregateRiskCounts } from "@/lib/reclamation/risk-snapshot";
import { getEffectiveSettings, type EffectiveSettings } from "@/lib/settings/effective";
import type { User } from "../../../drizzle/schema/users";
import { getBusinessTodayRange, type ReportsTimezone } from "./dates";
import type {
  AdminDashboardSummary,
  DashboardReclamationRiskSummary,
  DashboardSummary,
  StaffDashboardSummary,
} from "./dashboard-summary-types";

function emptyReclamationRisk(drilldownHref: string): DashboardReclamationRiskSummary {
  return {
    tomorrowCount: 0,
    within7Count: 0,
    within14Count: 0,
    pendingRiskCount: 0,
    memberCount: null,
    drilldownHref,
  };
}

async function countPendingReclamationCustomers(
  db: Database,
  userId?: string,
): Promise<number> {
  const conditions = [eq(schema.reclamationActionItems.actionState, "pending")];
  if (userId) {
    conditions.push(eq(schema.reclamationActionItems.userId, userId));
  }
  const row = await db
    .select({ value: count() })
    .from(schema.reclamationActionItems)
    .where(and(...conditions));
  return row[0]?.value ?? 0;
}

async function buildReclamationRiskSummary(
  db: Database,
  user: User,
  now: Date,
  settings: EffectiveSettings,
): Promise<DashboardReclamationRiskSummary> {
  try {
    const snapshots = await collectReclamationRiskSnapshots(db, now, settings);
    const scoped =
      user.role === "staff"
        ? snapshots.filter((snapshot) => snapshot.ownerId === user.id)
        : snapshots;

    const counts = aggregateRiskCounts(scoped);
    const memberIds = new Set(scoped.map((snapshot) => snapshot.ownerId));
    const pendingRiskCount = await countPendingReclamationCustomers(
      db,
      user.role === "staff" ? user.id : undefined,
    );

    return {
      tomorrowCount: counts.tomorrowCount,
      within7Count: counts.within7Count,
      within14Count: counts.within14Count,
      pendingRiskCount,
      memberCount: user.role === "admin" ? memberIds.size : null,
      drilldownHref:
        user.role === "admin"
          ? "/customers?reclamationRisk=team"
          : "/customers?reclamationRisk=mine",
    };
  } catch (error) {
    console.error("[dashboard-summary] reclamation risk failed", {
      userId: user.id,
      error,
    });
    return emptyReclamationRisk(
      user.role === "admin"
        ? "/customers?reclamationRisk=team"
        : "/customers?reclamationRisk=mine",
    );
  }
}

async function getStaffMetrics(
  db: Database,
  user: User,
  now: Date,
  timezone: ReportsTimezone,
): Promise<StaffDashboardSummary["metrics"]> {
  const nowIso = now.toISOString();
  const { start: todayStart, end: todayEnd } = getBusinessTodayRange(
    now,
    timezone,
  );
  const tomorrowStart = new Date(
    new Date(todayEnd).getTime() + 1,
  ).toISOString();
  const ownedScope = ownedNormalCustomerListWhere(user.id);

  const [
    myCustomersRow,
    dueTodayRow,
    overdueRow,
    validFollowUpsTodayRow,
    pendingWorkItems,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(and(ownedScope, eq(schema.customers.status, "active"))),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(
        and(
          ownedScope,
          eq(schema.customers.status, "active"),
          isNotNull(schema.customers.nextFollowUpAt),
          gte(schema.customers.nextFollowUpAt, nowIso),
          lt(schema.customers.nextFollowUpAt, tomorrowStart),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(
        and(
          ownedScope,
          eq(schema.customers.status, "active"),
          isNotNull(schema.customers.nextFollowUpAt),
          lt(schema.customers.nextFollowUpAt, nowIso),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.followUps)
      .where(
        and(
          eq(schema.followUps.userId, user.id),
          eq(schema.followUps.isValidFollowUp, 1),
          gte(schema.followUps.followUpTime, todayStart),
          lt(schema.followUps.followUpTime, tomorrowStart),
        ),
      ),
    getPendingActionCount(db, user.id).catch((error) => {
      console.error("[dashboard-summary] pending count failed", error);
      return 0;
    }),
  ]);

  return {
    myCustomerCount: myCustomersRow[0]?.value ?? 0,
    dueTodayFollowUps: dueTodayRow[0]?.value ?? 0,
    overdueFollowUps: overdueRow[0]?.value ?? 0,
    autoReleaseWithin7Days: 0,
    autoReleaseTomorrow: 0,
    pendingWorkItems,
    validFollowUpsToday: validFollowUpsTodayRow[0]?.value ?? 0,
  };
}

function applyReclamationMetricsToStaff(
  metrics: StaffDashboardSummary["metrics"],
  reclamationRisk: DashboardReclamationRiskSummary,
): StaffDashboardSummary["metrics"] {
  return {
    ...metrics,
    autoReleaseWithin7Days:
      reclamationRisk.tomorrowCount + reclamationRisk.within7Count,
    autoReleaseTomorrow: reclamationRisk.tomorrowCount,
  };
}

async function getAdminMetrics(
  db: Database,
  user: User,
  now: Date,
  timezone: ReportsTimezone,
): Promise<AdminDashboardSummary["metrics"]> {
  const nowIso = now.toISOString();
  const { start: todayStart, end: todayEnd } = getBusinessTodayRange(
    now,
    timezone,
  );
  const tomorrowStart = new Date(
    new Date(todayEnd).getTime() + 1,
  ).toISOString();
  const teamActiveScope = and(
    normalCustomerListStatusWhere(),
    isNotNull(schema.customers.ownerId),
    eq(schema.customers.status, "active"),
  )!;

  const [
    totalCustomersRow,
    newCustomersTodayRow,
    validFollowUpsTodayRow,
    pendingApprovalsRow,
    overdueRow,
    publicPoolTodayRow,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(ne(schema.customers.status, "archived")),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(
        and(
          isNull(schema.customers.deletedAt),
          ne(schema.customers.status, "archived"),
          gte(schema.customers.createdAt, todayStart),
          lt(schema.customers.createdAt, tomorrowStart),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.followUps)
      .where(
        and(
          eq(schema.followUps.isValidFollowUp, 1),
          gte(schema.followUps.followUpTime, todayStart),
          lt(schema.followUps.followUpTime, tomorrowStart),
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
          teamActiveScope,
          isNotNull(schema.customers.nextFollowUpAt),
          lt(schema.customers.nextFollowUpAt, nowIso),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.status, "public_pool"),
          isNotNull(schema.customers.poolEnteredAt),
          gte(schema.customers.poolEnteredAt, todayStart),
          lt(schema.customers.poolEnteredAt, tomorrowStart),
        ),
      ),
  ]);

  return {
    totalCustomers: totalCustomersRow[0]?.value ?? 0,
    newCustomersToday: newCustomersTodayRow[0]?.value ?? 0,
    validFollowUpsToday: validFollowUpsTodayRow[0]?.value ?? 0,
    pendingApprovals: pendingApprovalsRow[0]?.value ?? 0,
    autoReleaseWithin7Days: 0,
    autoReleaseTomorrow: 0,
    overdueFollowUps: overdueRow[0]?.value ?? 0,
    publicPoolEnteredToday: publicPoolTodayRow[0]?.value ?? 0,
  };
}

function applyReclamationMetricsToAdmin(
  metrics: AdminDashboardSummary["metrics"],
  reclamationRisk: DashboardReclamationRiskSummary,
): AdminDashboardSummary["metrics"] {
  return {
    ...metrics,
    autoReleaseWithin7Days:
      reclamationRisk.tomorrowCount + reclamationRisk.within7Count,
    autoReleaseTomorrow: reclamationRisk.tomorrowCount,
  };
}

export async function getDashboardSummary(
  db: Database,
  user: User,
  now: Date = new Date(),
): Promise<DashboardSummary> {
  const settings = await getEffectiveSettings(db);
  const timezone = settings.businessTimezone;

  if (user.role === "admin") {
    const [baseMetrics, reclamationRisk] = await Promise.all([
      getAdminMetrics(db, user, now, timezone),
      buildReclamationRiskSummary(db, user, now, settings),
    ]);

    return {
      role: "admin",
      greeting: {
        displayName: user.displayName,
        dueTodayCount: null,
      },
      metrics: applyReclamationMetricsToAdmin(baseMetrics, reclamationRisk),
      reclamationRisk,
    };
  }

  const [baseMetrics, reclamationRisk] = await Promise.all([
    getStaffMetrics(db, user, now, timezone),
    buildReclamationRiskSummary(db, user, now, settings),
  ]);
  const metrics = applyReclamationMetricsToStaff(baseMetrics, reclamationRisk);

  return {
    role: "staff",
    greeting: {
      displayName: user.displayName,
      dueTodayCount: metrics.dueTodayFollowUps,
    },
    metrics,
    reclamationRisk,
  };
}

export async function getStaffDashboardSummary(
  db: Database,
  user: User,
  now?: Date,
): Promise<StaffDashboardSummary> {
  const summary = await getDashboardSummary(db, user, now);
  if (summary.role !== "staff") {
    throw new Error("Expected staff dashboard summary");
  }
  return summary;
}

export async function getAdminDashboardSummary(
  db: Database,
  user: User,
  now?: Date,
): Promise<AdminDashboardSummary> {
  const summary = await getDashboardSummary(db, user, now);
  if (summary.role !== "admin") {
    throw new Error("Expected admin dashboard summary");
  }
  return summary;
}
