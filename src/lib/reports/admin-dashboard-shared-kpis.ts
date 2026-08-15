import { count, eq, ne } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  recordAdminDashboardPendingApprovalsPhysicalLoad,
  recordAdminDashboardSharedKpiPhysicalLoad,
  recordAdminDashboardTotalCustomersPhysicalLoad,
} from "./admin-dashboard-request-instrumentation";

export type SharedAdminDashboardKpis = {
  totalCustomers: number;
  pendingApprovals: number;
};

export type SharedAdminDashboardKpisInput =
  | SharedAdminDashboardKpis
  | Promise<SharedAdminDashboardKpis>;

/** Resolve shared KPI scalars for parallel count batches. */
export function sharedKpiCountPromises(
  db: Database,
  sharedKpis?: SharedAdminDashboardKpisInput,
): {
  totalCustomers: Promise<number>;
  pendingApprovals: Promise<number>;
} {
  if (!sharedKpis) {
    return {
      totalCustomers: countAdminDashboardTotalCustomers(db),
      pendingApprovals: countAdminDashboardPendingApprovals(db),
    };
  }
  const resolved = Promise.resolve(sharedKpis);
  return {
    totalCustomers: resolved.then((kpis) => kpis.totalCustomers),
    pendingApprovals: resolved.then((kpis) => kpis.pendingApprovals),
  };
}

/** Non-archived customers — same predicate as legacy stats and summary admin metrics. */
export async function countAdminDashboardTotalCustomers(
  db: Database,
): Promise<number> {
  recordAdminDashboardTotalCustomersPhysicalLoad();
  const row = await db
    .select({ value: count() })
    .from(schema.customers)
    .where(ne(schema.customers.status, "archived"));
  return row[0]?.value ?? 0;
}

/** Pending approvals — same predicate as legacy stats and summary admin metrics. */
export async function countAdminDashboardPendingApprovals(
  db: Database,
): Promise<number> {
  recordAdminDashboardPendingApprovalsPhysicalLoad();
  const row = await db
    .select({ value: count() })
    .from(schema.approvals)
    .where(eq(schema.approvals.status, "pending"));
  return row[0]?.value ?? 0;
}

/** Load shared admin KPI scalars once per orchestrated Admin Dashboard request. */
export async function loadSharedAdminDashboardKpis(
  db: Database,
): Promise<SharedAdminDashboardKpis> {
  recordAdminDashboardSharedKpiPhysicalLoad();
  const [totalCustomers, pendingApprovals] = await Promise.all([
    countAdminDashboardTotalCustomers(db),
    countAdminDashboardPendingApprovals(db),
  ]);
  return { totalCustomers, pendingApprovals };
}
