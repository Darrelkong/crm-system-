import { and, gte, isNotNull, lt, type SQL } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";
import { ownedNormalCustomerListWhere } from "./customer-list-filters";
import { normalCustomerListStatusWhere } from "./customer-list-filters";

export const WORK_VIEW_VALUES = ["dueToday", "overdue"] as const;
export type WorkView = (typeof WORK_VIEW_VALUES)[number];

export function parseWorkView(
  raw: string | undefined,
): WorkView | undefined {
  if (!raw) return undefined;
  return WORK_VIEW_VALUES.includes(raw as WorkView)
    ? (raw as WorkView)
    : undefined;
}

/**
 * Server-side follow-up drilldown for customer list.
 * Staff: own customers only. Admin overdue: team active customers.
 */
export function buildWorkViewWhere(
  user: User,
  workView: WorkView,
  nowIso: string,
  todayEndIso: string,
): SQL | undefined {
  if (workView === "dueToday") {
    if (user.role !== "staff" && user.role !== "admin") {
      return undefined;
    }
    const scope =
      user.role === "staff"
        ? ownedNormalCustomerListWhere(user.id)
        : and(
            normalCustomerListStatusWhere(),
            isNotNull(schema.customers.ownerId),
          )!;
    return and(
      scope,
      isNotNull(schema.customers.nextFollowUpAt),
      gte(schema.customers.nextFollowUpAt, nowIso),
      lt(schema.customers.nextFollowUpAt, todayEndIso),
    )!;
  }

  if (workView === "overdue") {
    const scope =
      user.role === "staff"
        ? ownedNormalCustomerListWhere(user.id)
        : and(
            normalCustomerListStatusWhere(),
            isNotNull(schema.customers.ownerId),
          )!;
    return and(
      scope,
      isNotNull(schema.customers.nextFollowUpAt),
      lt(schema.customers.nextFollowUpAt, nowIso),
    )!;
  }

  return undefined;
}

/** Reject team-only drilldown params for staff (URL tampering). */
export function parseReclamationRiskParam(
  user: User,
  raw: string | undefined,
): "mine" | "team" | undefined {
  if (!raw) return undefined;
  if (raw === "mine") return "mine";
  if (raw === "team" && user.role === "admin") return "team";
  return undefined;
}
