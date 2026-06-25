export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { listCustomersForUser } from "@/lib/customers/queries";
import {
  filterCustomersWithScores,
  getCustomerIdsWithFollowUps,
  getCustomersWithScores,
} from "@/lib/customers/scoring/service";
import { HEAT_LEVELS } from "@/lib/customers/scoring/types";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { getDb } from "@/lib/db";
import type { HeatLevel } from "@/lib/customers/scoring/types";
import { CustomersListClient } from "./customers-list-client";

type Props = {
  searchParams: Promise<{
    status?: string;
    heat?: string;
    completenessBelow?: string;
  }>;
};

export default async function CustomersPage({ searchParams }: Props) {
  const user = await requireAuth();
  const params = await searchParams;
  const showArchived = user.role === "admin" && params.status === "archived";

  const db = getDb();
  const customers = await listCustomersForUser(
    user,
    showArchived ? { status: "archived" } : {},
  );
  const followUpSet = await getCustomerIdsWithFollowUps(
    db,
    customers.map((c) => c.id),
  );
  const settings = await getEffectiveSettings(db);

  const scoringFilter: {
    heat?: HeatLevel;
    completenessBelow?: number;
  } = {};
  if (params.heat && (HEAT_LEVELS as readonly string[]).includes(params.heat)) {
    scoringFilter.heat = params.heat as HeatLevel;
  }
  if (params.completenessBelow) {
    const n = Number(params.completenessBelow);
    if (Number.isFinite(n)) scoringFilter.completenessBelow = n;
  }

  const views = filterCustomersWithScores(
    getCustomersWithScores(user, customers, followUpSet, settings),
    scoringFilter,
  );

  const baseQuery = showArchived ? "?status=archived" : "";

  return (
    <CustomersListClient
      initialRows={views.map((c) => ({
        id: c.id,
        customerCode: c.customerCode,
        customerName: c.customerName,
        customerType: c.customerType,
        source: c.source,
        salesStage: c.salesStage,
        status: c.status,
        heatLevel: c.heatLevel,
        completenessScore: c.completenessScore,
        neverContacted: c.neverContacted,
        overdueFollowUp: c.overdueFollowUp,
        isArchived: !!c.isArchived,
        isMasked: !!c.isMasked,
        createdAt: c.createdAt,
      }))}
      showArchived={showArchived}
      isAdmin={user.role === "admin"}
      filterHeat={params.heat}
      filterCompletenessBelow={params.completenessBelow}
      baseQuery={baseQuery}
    />
  );
}
