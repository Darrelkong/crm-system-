import type { Database } from "@/lib/db";
import type { HeatLevel } from "@/lib/customers/scoring/types";
import type { CustomerWithScores } from "@/lib/customers/scoring/service";
import { resolveUserDisplayNames } from "@/lib/customers/user-labels";

export type CustomerListRowData = {
  id: string;
  customerCode?: string | null;
  customerName: string;
  ownerId: string | null;
  ownerName: string | null;
  requestedProjectName?: string | null;
  salesStage: string;
  status: string;
  heatLevel: HeatLevel;
  completenessScore: number;
  neverContacted: boolean;
  overdueFollowUp: boolean;
  isArchived: boolean;
  isMasked: boolean;
  createdAt: string;
};

export function toCustomerListRow(
  customer: CustomerWithScores,
  ownerName: string | null,
): CustomerListRowData {
  return {
    id: customer.id,
    customerCode: customer.customerCode,
    customerName: customer.customerName,
    ownerId: customer.ownerId ?? null,
    ownerName,
    requestedProjectName: customer.requestedProjectName,
    salesStage: customer.salesStage,
    status: customer.status,
    heatLevel: customer.heatLevel,
    completenessScore: customer.completenessScore,
    neverContacted: customer.neverContacted,
    overdueFollowUp: customer.overdueFollowUp,
    isArchived: !!customer.isArchived,
    isMasked: !!customer.isMasked,
    createdAt: customer.createdAt,
  };
}

export async function buildCustomerListRows(
  db: Database,
  items: CustomerWithScores[],
): Promise<CustomerListRowData[]> {
  const nameMap = await resolveUserDisplayNames(
    db,
    items.map((item) => item.ownerId),
  );

  return items.map((item) =>
    toCustomerListRow(
      item,
      item.ownerId ? (nameMap.get(item.ownerId) ?? null) : null,
    ),
  );
}

export function formatProjectNameForList(
  name: string | null | undefined,
  maxLength = 6,
): { display: string; title?: string } {
  const trimmed = name?.trim();
  if (!trimmed) {
    return { display: "—" };
  }
  if (trimmed.length <= maxLength) {
    return { display: trimmed };
  }
  return {
    display: `${trimmed.slice(0, maxLength)}…`,
    title: trimmed,
  };
}
