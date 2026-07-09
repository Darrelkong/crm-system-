import { and, count, desc, eq, gte, lt, lte } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  normalCustomerListStatusWhere,
  ownedNormalCustomerListWhere,
} from "@/lib/customers/customer-list-filters";
import { getEffectiveSettings } from "@/lib/settings/effective";
import type { User } from "../../../drizzle/schema/users";
import {
  getBusinessMonthRange,
  getBusinessTodayRange,
  getBusinessWeekRange,
} from "./dates";
import { listRecentFollowUpsForStaff } from "./recent-follow-ups";
import type { StaffReportsStats } from "./types";

function ownedNonArchivedFilter(userId: string) {
  return ownedNormalCustomerListWhere(userId);
}

function ownedNewCustomerFilter(
  userId: string,
  start: string,
  endExclusive: string,
) {
  return and(
    ownedNormalCustomerListWhere(userId),
    gte(schema.customers.createdAt, start),
    lt(schema.customers.createdAt, endExclusive),
  );
}

function staffFollowUpFilter(
  userId: string,
  start: string,
  endExclusive: string,
) {
  return and(
    eq(schema.followUps.userId, userId),
    gte(schema.followUps.followUpTime, start),
    lt(schema.followUps.followUpTime, endExclusive),
  );
}

export async function getStaffReportsStats(
  db: Database,
  user: User,
  now: Date = new Date(),
): Promise<StaffReportsStats> {
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

  const ownedActiveFilter = and(
    eq(schema.customers.ownerId, user.id),
    eq(schema.customers.status, "active"),
  );

  const [
    myCustomersRow,
    newTodayRow,
    newWeekRow,
    newMonthRow,
    followUpsTodayRow,
    followUpsWeekRow,
    followUpsMonthRow,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(ownedActiveFilter),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.ownerId, user.id),
          gte(schema.customers.createdAt, todayStart),
          lte(schema.customers.createdAt, todayEnd),
          normalCustomerListStatusWhere(),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(ownedNewCustomerFilter(user.id, weekStart, weekEndExclusive)),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(ownedNewCustomerFilter(user.id, monthStart, monthEndExclusive)),
    db
      .select({ value: count() })
      .from(schema.followUps)
      .where(
        and(
          eq(schema.followUps.userId, user.id),
          gte(schema.followUps.followUpTime, todayStart),
          lte(schema.followUps.followUpTime, todayEnd),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.followUps)
      .where(staffFollowUpFilter(user.id, weekStart, weekEndExclusive)),
    db
      .select({ value: count() })
      .from(schema.followUps)
      .where(staffFollowUpFilter(user.id, monthStart, monthEndExclusive)),
  ]);

  const [stageRows, recentFollowUps] = await Promise.all([
    db
      .select({
        label: schema.customers.salesStage,
        count: count(),
      })
      .from(schema.customers)
      .where(ownedNonArchivedFilter(user.id))
      .groupBy(schema.customers.salesStage)
      .orderBy(desc(count())),
    listRecentFollowUpsForStaff(db, user.id),
  ]);

  return {
    myCustomers: myCustomersRow[0]?.value ?? 0,
    myNewCustomersToday: newTodayRow[0]?.value ?? 0,
    myNewCustomersThisWeek: newWeekRow[0]?.value ?? 0,
    myNewCustomersThisMonth: newMonthRow[0]?.value ?? 0,
    myFollowUpsToday: followUpsTodayRow[0]?.value ?? 0,
    myFollowUpsThisWeek: followUpsWeekRow[0]?.value ?? 0,
    myFollowUpsThisMonth: followUpsMonthRow[0]?.value ?? 0,
    myCustomersBySalesStage: stageRows.map((r) => ({
      label: r.label,
      count: r.count,
    })),
    recentFollowUps,
  };
}
