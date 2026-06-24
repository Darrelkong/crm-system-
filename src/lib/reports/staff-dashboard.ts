import {
  and,
  count,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
} from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { getStaffClaimStatus } from "@/lib/public-pool/claim-limits";
import {
  getDaysWithoutValidFollowUp,
} from "@/lib/reclamation/days";
import { getEffectiveSettings } from "@/lib/settings/effective";
import type { User } from "../../../drizzle/schema/users";
import {
  getBusinessMonthRange,
  getBusinessTodayRange,
  getRollingSevenDaysAgoIso,
} from "./dates";
import type { StaffDashboardStats } from "./types";

export async function getStaffDashboardStats(
  db: Database,
  user: User,
  now: Date = new Date(),
): Promise<StaffDashboardStats> {
  const settings = await getEffectiveSettings(db);
  const timezone = settings.businessTimezone;
  const { start: monthStart, endExclusive: monthEndExclusive } =
    getBusinessMonthRange(now, timezone);
  const nowIso = now.toISOString();
  const sevenDaysAgo = getRollingSevenDaysAgoIso(now);
  const { start: todayStart, end: todayEnd } = getBusinessTodayRange(
    now,
    timezone,
  );

  const ownedActiveFilter = and(
    eq(schema.customers.ownerId, user.id),
    eq(schema.customers.status, "active"),
  );

  const [
    myCustomersRow,
    myTodayTasksRow,
    myOverdueTasksRow,
    myPendingApprovalsRow,
    myNewCustomersRow,
    myFollowUpsRow,
    myValidFollowUpsRow,
    myClosedWonRow,
    myClaimedRow,
    myNeverContactedRow,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(ownedActiveFilter),
    db
      .select({ value: count() })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.assignedTo, user.id),
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
          eq(schema.tasks.assignedTo, user.id),
          eq(schema.tasks.status, "open"),
          isNotNull(schema.tasks.dueAt),
          lt(schema.tasks.dueAt, nowIso),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.requestedBy, user.id),
          eq(schema.approvals.status, "pending"),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.ownerId, user.id),
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
          eq(schema.followUps.userId, user.id),
          gte(schema.followUps.followUpTime, monthStart),
          lt(schema.followUps.followUpTime, monthEndExclusive),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.followUps)
      .where(
        and(
          eq(schema.followUps.userId, user.id),
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
          ownedActiveFilter,
          eq(schema.customers.salesStage, "closed_won"),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.claimedBy, user.id),
          isNotNull(schema.customers.claimedAt),
          gte(schema.customers.claimedAt, sevenDaysAgo),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.customers)
      .where(
        and(
          ownedActiveFilter,
          isNull(schema.customers.lastValidFollowUpAt),
        ),
      ),
  ]);

  const ownedActiveCustomers = await db
    .select()
    .from(schema.customers)
    .where(ownedActiveFilter);

  const myReclaimRiskCustomers = ownedActiveCustomers.filter((customer) => {
    const days = getDaysWithoutValidFollowUp(customer, now);
    return (
      days >= settings.reclaimWarningDay1 &&
      days < settings.automaticReclaimDays
    );
  }).length;

  const claimStatus = await getStaffClaimStatus(user.id, now, db);

  return {
    myCustomers: myCustomersRow[0]?.value ?? 0,
    myTodayTasks: myTodayTasksRow[0]?.value ?? 0,
    myOverdueTasks: myOverdueTasksRow[0]?.value ?? 0,
    myPendingApprovals: myPendingApprovalsRow[0]?.value ?? 0,
    myNewCustomersThisMonth: myNewCustomersRow[0]?.value ?? 0,
    myFollowUpsThisMonth: myFollowUpsRow[0]?.value ?? 0,
    myValidFollowUpsThisMonth: myValidFollowUpsRow[0]?.value ?? 0,
    myClosedWonCustomers: myClosedWonRow[0]?.value ?? 0,
    myClaimedFromPoolLast7Days: myClaimedRow[0]?.value ?? 0,
    myNeverContactedCustomers: myNeverContactedRow[0]?.value ?? 0,
    myReclaimRiskCustomers,
    publicPoolClaimStatus: {
      claimedInLast7Days: claimStatus.claimedInLast7Days,
      remainingQuota: claimStatus.remainingQuota,
      quotaLimit: claimStatus.quotaLimit,
      cooldownHours: claimStatus.cooldownHours,
      inCooldown: claimStatus.inCooldown,
      cooldownUntil: claimStatus.cooldownUntil,
      canClaimNow: claimStatus.canClaimNow,
      blockedReason: claimStatus.blockedReason,
    },
  };
}
