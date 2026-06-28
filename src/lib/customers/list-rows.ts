import type { Database } from "@/lib/db";
import type { HeatLevel } from "@/lib/customers/scoring/types";
import type { CustomerWithScores } from "@/lib/customers/scoring/service";
import { listCustomerAssigneesByCustomerIds } from "@/lib/customers/assignees";
import { resolveUserDisplayNames } from "@/lib/customers/user-labels";

export type CustomerListRowData = {
  id: string;
  customerCode?: string | null;
  customerName: string;
  ownerId: string | null;
  ownerName: string | null;
  assigneeNames: string[];
  requestedProjectName?: string | null;
  salesStage: string;
  status: string;
  heatLevel: HeatLevel;
  completenessScore: number;
  neverContacted: boolean;
  overdueFollowUp: boolean;
  isArchived: boolean;
  isMasked: boolean;
  isPinned: boolean;
  pinnedAt?: string | null;
  createdAt: string;
};

export function toCustomerListRow(
  customer: CustomerWithScores,
  ownerName: string | null,
  assigneeNames: string[] = [],
): CustomerListRowData {
  return {
    id: customer.id,
    customerCode: customer.customerCode,
    customerName: customer.customerName,
    ownerId: customer.ownerId ?? null,
    ownerName,
    assigneeNames,
    requestedProjectName: customer.requestedProjectName,
    salesStage: customer.salesStage,
    status: customer.status,
    heatLevel: customer.heatLevel,
    completenessScore: customer.completenessScore,
    neverContacted: customer.neverContacted,
    overdueFollowUp: customer.overdueFollowUp,
    isArchived: !!customer.isArchived,
    isMasked: !!customer.isMasked,
    isPinned: customer.isPinned,
    pinnedAt: customer.pinnedAt ?? null,
    createdAt: customer.createdAt,
  };
}

export async function buildCustomerListRows(
  db: Database,
  items: CustomerWithScores[],
): Promise<CustomerListRowData[]> {
  const customerIds = items.map((item) => item.id);
  const assigneesByCustomerId = await listCustomerAssigneesByCustomerIds(
    db,
    customerIds,
  );

  const userIds = new Set<string>();
  for (const item of items) {
    if (item.ownerId) {
      userIds.add(item.ownerId);
    }
    for (const assignee of assigneesByCustomerId.get(item.id) ?? []) {
      userIds.add(assignee.userId);
    }
  }

  const nameMap = await resolveUserDisplayNames(db, [...userIds]);

  return items.map((item) => {
    const assigneeNames = (assigneesByCustomerId.get(item.id) ?? [])
      .map((assignee) => nameMap.get(assignee.userId))
      .filter((name): name is string => !!name?.trim());

    return toCustomerListRow(
      item,
      item.ownerId ? (nameMap.get(item.ownerId) ?? null) : null,
      assigneeNames,
    );
  });
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
