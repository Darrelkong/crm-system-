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
import { getEffectiveSettings } from "@/lib/settings/effective";
import {
  getBusinessMonthRange,
  getBusinessTodayRange,
  getBusinessWeekRange,
} from "./dates";
import { listRecentFollowUpsForAdmin } from "./recent-follow-ups";
import type { AdminReportsStats } from "./types";

function newCustomerFilter(start: string, endExclusive: string) {
  return and(
    gte(schema.customers.createdAt, start),
    lt(schema.customers.createdAt, endExclusive),
    ne(schema.customers.status, "archived"),
  );
}

function followUpFilter(start: string, endExclusive: string) {
  return and(
    gte(schema.followUps.followUpTime, start),
    lt(schema.followUps.followUpTime, endExclusive),
  );
}

export async function getAdminReportsStats(
  db: Database,
  now: Date = new Date(),
): Promise<AdminReportsStats> {
  const settings = await getEffectiveSettings(db);
  const timezone = settings.businessTimezone;
  const { start: todayStart, end: todayEnd } = getBusinessTodayRange(
    now,
    timezone,
  );
  const { start: weekStart, endExclusive: weekEndExclusive } =
    getBusinessWeekRange(now, timezone);
  const { start: monthStart, endExclusive: monthEndExclusive } =
    getBusinessMonthRange(now, timezone);

  const [
    totalCustomersRow,
    newTodayRow,
    newWeekRow,
    newMonthRow,
    followUpsTodayRow,
    followUpsWeekRow,
    followUpsMonthRow,
    pendingApprovalsRow,
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
          gte(schema.customers.createdAt, todayStart),
          lte(schema.customers.createdAt, todayEnd),
          ne(schema.customers.status, "archived"),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(newCustomerFilter(weekStart, weekEndExclusive)),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(newCustomerFilter(monthStart, monthEndExclusive)),
    db
      .select({ value: count() })
      .from(schema.followUps)
      .where(
        and(
          gte(schema.followUps.followUpTime, todayStart),
          lte(schema.followUps.followUpTime, todayEnd),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.followUps)
      .where(followUpFilter(weekStart, weekEndExclusive)),
    db
      .select({ value: count() })
      .from(schema.followUps)
      .where(followUpFilter(monthStart, monthEndExclusive)),
    db
      .select({ value: count() })
      .from(schema.approvals)
      .where(eq(schema.approvals.status, "pending")),
  ]);

  const [stageRows, ownerRows, recentFollowUps] = await Promise.all([
    db
      .select({
        label: schema.customers.salesStage,
        count: count(),
      })
      .from(schema.customers)
      .where(ne(schema.customers.status, "archived"))
      .groupBy(schema.customers.salesStage)
      .orderBy(desc(count())),
    db
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
      .orderBy(desc(count())),
    listRecentFollowUpsForAdmin(db),
  ]);

  return {
    totalCustomers: totalCustomersRow[0]?.value ?? 0,
    newCustomersToday: newTodayRow[0]?.value ?? 0,
    newCustomersThisWeek: newWeekRow[0]?.value ?? 0,
    newCustomersThisMonth: newMonthRow[0]?.value ?? 0,
    followUpsToday: followUpsTodayRow[0]?.value ?? 0,
    followUpsThisWeek: followUpsWeekRow[0]?.value ?? 0,
    followUpsThisMonth: followUpsMonthRow[0]?.value ?? 0,
    pendingApprovals: pendingApprovalsRow[0]?.value ?? 0,
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
    recentFollowUps,
  };
}
