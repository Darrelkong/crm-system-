import { and, asc, count, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import {
  computeRemaining,
  getHongKongUsageDate,
  STAFF_AI_ADMIN_STAFF_LIST_LIMIT,
} from "@/lib/ai/staff-usage/service";

export type AdminStaffAiUsageRow = {
  userId: string;
  displayName: string;
  used: number;
  remaining: number;
  dailyLimit: number;
  status: "ok" | "limit_reached" | "disabled";
};

export type AdminStaffAiUsageStats = {
  usageDate: string;
  staffDeepAnalysisEnabled: boolean;
  staffFollowUpOrganizationEnabled: boolean;
  dailyLimit: number;
  todaySuccessTotal: number;
  todayActiveStaffCount: number;
  staff: AdminStaffAiUsageRow[];
  staffListLimit: number;
  hasMore: boolean;
};

/**
 * Admin-only today usage summary. Aggregates in SQL (succeeded only).
 * Active staff listed; Admin accounts excluded from per-staff usage table.
 */
export async function getAdminStaffAiUsageStats(
  db: Database,
  settings: EffectiveAiSettings,
  now: Date = new Date(),
): Promise<AdminStaffAiUsageStats> {
  const usageDate = getHongKongUsageDate(now);
  const dailyLimit = settings.aiStaffDailyLimit;
  const anyStaffFeatureEnabled =
    settings.aiStaffDeepAnalysisEnabled ||
    settings.aiStaffFollowUpOrganizationEnabled;

  const [totalRow] = await db
    .select({
      value: sql<number>`coalesce(sum(${schema.aiStaffDailyQuota.succeededCount}), 0)`,
    })
    .from(schema.aiStaffDailyQuota)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.aiStaffDailyQuota.userId),
    )
    .where(
      and(
        eq(schema.aiStaffDailyQuota.usageDate, usageDate),
        eq(schema.users.role, "staff"),
      ),
    );

  const todaySuccessTotal = Number(totalRow?.value ?? 0);

  const [activeUsedRow] = await db
    .select({ value: count() })
    .from(schema.aiStaffDailyQuota)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.aiStaffDailyQuota.userId),
    )
    .where(
      and(
        eq(schema.aiStaffDailyQuota.usageDate, usageDate),
        sql`${schema.aiStaffDailyQuota.succeededCount} > 0`,
        eq(schema.users.role, "staff"),
        eq(schema.users.isActive, 1),
        sql`${schema.users.deletedAt} is null`,
      ),
    );

  const [activeStaffTotalRow] = await db
    .select({ value: count() })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.role, "staff"),
        eq(schema.users.isActive, 1),
        sql`${schema.users.deletedAt} is null`,
      ),
    );

  const staffUsers = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      succeededCount: schema.aiStaffDailyQuota.succeededCount,
    })
    .from(schema.users)
    .leftJoin(
      schema.aiStaffDailyQuota,
      and(
        eq(schema.aiStaffDailyQuota.userId, schema.users.id),
        eq(schema.aiStaffDailyQuota.usageDate, usageDate),
      ),
    )
    .where(
      and(
        eq(schema.users.role, "staff"),
        eq(schema.users.isActive, 1),
        sql`${schema.users.deletedAt} is null`,
      ),
    )
    .orderBy(asc(schema.users.displayName))
    .limit(STAFF_AI_ADMIN_STAFF_LIST_LIMIT);

  const staff: AdminStaffAiUsageRow[] = staffUsers.map((row) => {
    const used = row.succeededCount ?? 0;
    const remaining = anyStaffFeatureEnabled
      ? computeRemaining(used, dailyLimit)
      : 0;
    let status: AdminStaffAiUsageRow["status"] = "ok";
    if (!anyStaffFeatureEnabled) status = "disabled";
    else if (remaining <= 0) status = "limit_reached";

    return {
      userId: row.id,
      displayName: row.displayName,
      used,
      remaining,
      dailyLimit,
      status,
    };
  });

  const activeStaffTotal = activeStaffTotalRow?.value ?? 0;

  return {
    usageDate,
    staffDeepAnalysisEnabled: settings.aiStaffDeepAnalysisEnabled,
    staffFollowUpOrganizationEnabled:
      settings.aiStaffFollowUpOrganizationEnabled,
    dailyLimit,
    todaySuccessTotal,
    todayActiveStaffCount: activeUsedRow?.value ?? 0,
    staff,
    staffListLimit: STAFF_AI_ADMIN_STAFF_LIST_LIMIT,
    hasMore: activeStaffTotal > staff.length,
  };
}
