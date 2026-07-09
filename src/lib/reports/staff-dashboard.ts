import {
  and,
  count,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
} from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { normalCustomerListStatusWhere } from "@/lib/customers/customer-list-filters";
import { getStaffClaimStatus } from "@/lib/public-pool/claim-limits";
import { RECLAMATION_EXCLUDED_SALES_STAGES } from "@/lib/reclamation/constants";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { computeScoringSummaryForStaff } from "@/lib/customers/scoring/service";
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
    myReclaimRiskRow,
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
          normalCustomerListStatusWhere(),
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
    // SQL COUNT for reclaim risk: replicates the JS filter that was previously
    // applied to the ownedActiveCustomers full-table fetch.
    // Conditions mirror isReclamationEligibleCustomer + getDaysWithoutValidFollowUp:
    //   - sales_stage NOT IN (closed_won, converted, on_hold)
    //   - is_pinned = 0
    //   - days_without_valid >= warningThreshold AND < automaticReclaimDays
    db
      .select({ cnt: sql<number>`count(*)` })
      .from(schema.customers)
      .where(
        and(
          ownedActiveFilter,
          notInArray(schema.customers.salesStage, [
            ...RECLAMATION_EXCLUDED_SALES_STAGES,
          ]),
          eq(schema.customers.isPinned, 0),
          sql`CAST((julianday(${nowIso}) - julianday(COALESCE(last_valid_follow_up_at, created_at))) AS INTEGER) >= ${settings.reclaimWarningThresholdDays}`,
          sql`CAST((julianday(${nowIso}) - julianday(COALESCE(last_valid_follow_up_at, created_at))) AS INTEGER) < ${settings.automaticReclaimDays}`,
        ),
      ),
  ]);

  const myReclaimRiskCustomers = Number(myReclaimRiskRow[0]?.cnt ?? 0);

  const claimStatus = await getStaffClaimStatus(user.id, now, db);
  // Pass `settings` to avoid a second getEffectiveSettings DB round-trip inside
  // computeScoringSummaryForStaff.
  const scoringSummary = await computeScoringSummaryForStaff(
    db,
    user,
    now,
    settings,
  );

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
    myHighChurnRiskCustomers: scoringSummary.highChurnRiskCustomers,
    myLowCompletenessCustomers: scoringSummary.lowCompletenessCustomers,
    publicPoolClaimStatus: {
      claimedInLast7Days: claimStatus.claimedInLast7Days,
      remainingQuota: claimStatus.remainingQuota,
      quotaLimit: claimStatus.quotaLimit,
      cooldownHours: claimStatus.cooldownHours,
      inCooldown: claimStatus.inCooldown,
      cooldownUntil: claimStatus.cooldownUntil,
      canClaimNow: claimStatus.canClaimNow,
      blockedReasonKey: claimStatus.blockedReasonKey,
      blockedReasonParams: claimStatus.blockedReasonParams,
    },
  };
}
