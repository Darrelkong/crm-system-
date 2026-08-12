import type { Database } from "@/lib/db";
import type { HeatLevel } from "@/lib/customers/scoring/types";
import type { CustomerWithScores } from "@/lib/customers/scoring/service";
import type { ReclamationCountdownDisplay } from "@/lib/reclamation/countdown-display";
import {
  listCustomerAssigneesByCustomerIds,
  type CustomerAssigneeRecord,
} from "@/lib/customers/assignees";
import { getCustomerIdsWithHouseholdIcon } from "@/lib/customers/households/list-indicator";
import { resolveUserDisplayNames } from "@/lib/customers/user-labels";

export type CustomerListRowData = {
  id: string;
  customerCode?: string | null;
  customerName: string;
  nameStatus: string;
  ownerId: string | null;
  ownerName: string | null;
  assigneeNames: string[];
  requestedProjectCode?: string | null;
  requestedProjectName?: string | null;
  salesStage: string;
  lifecycleStatus?: string | null;
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
  /** Auto-release countdown badge; null when ineligible or collaborative. */
  reclamationCountdown: ReclamationCountdownDisplay | null;
  hasHouseholdIcon: boolean;
};

export function toCustomerListRow(
  customer: CustomerWithScores,
  ownerName: string | null,
  assigneeNames: string[] = [],
  options?: { isCollaborative?: boolean; hasHouseholdIcon?: boolean },
): CustomerListRowData {
  return {
    id: customer.id,
    customerCode: customer.customerCode,
    customerName: customer.customerName,
    nameStatus: customer.nameStatus ?? "confirmed",
    ownerId: customer.ownerId ?? null,
    ownerName,
    assigneeNames,
    requestedProjectCode: customer.requestedProjectCode,
    requestedProjectName: customer.requestedProjectName,
    salesStage: customer.salesStage,
    lifecycleStatus: customer.lifecycleStatus ?? null,
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
    reclamationCountdown: options?.isCollaborative
      ? null
      : (customer.reclamationCountdown ?? null),
    hasHouseholdIcon: options?.hasHouseholdIcon ?? false,
  };
}

export type BuildCustomerListRowsOptions = {
  assigneesByCustomerId?: Map<string, CustomerAssigneeRecord[]>;
  householdIconCustomerIds?: ReadonlySet<string>;
};

export async function buildCustomerListRows(
  db: Database,
  items: CustomerWithScores[],
  options?: BuildCustomerListRowsOptions,
): Promise<CustomerListRowData[]> {
  const customerIds = items.map((item) => item.id);
  const [assigneesByCustomerId, householdIconCustomerIds] = await Promise.all([
    options?.assigneesByCustomerId !== undefined
      ? Promise.resolve(options.assigneesByCustomerId)
      : listCustomerAssigneesByCustomerIds(db, customerIds),
    options?.householdIconCustomerIds !== undefined
      ? Promise.resolve(options.householdIconCustomerIds)
      : getCustomerIdsWithHouseholdIcon(db, customerIds),
  ]);

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
    const assignees = assigneesByCustomerId.get(item.id) ?? [];
    const assigneeNames = assignees
      .map((assignee) => nameMap.get(assignee.userId))
      .filter((name): name is string => !!name?.trim());
    const isCollaborative = assignees.some(
      (assignee) => assignee.role === "collaborator",
    );

    return toCustomerListRow(
      item,
      item.ownerId ? (nameMap.get(item.ownerId) ?? null) : null,
      assigneeNames,
      {
        isCollaborative,
        hasHouseholdIcon: householdIconCustomerIds.has(item.id),
      },
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
