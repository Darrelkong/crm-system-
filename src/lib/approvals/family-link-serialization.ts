import type { ApprovalListItem } from "./queries";

export type FamilyLinkAdminDetail = {
  targetCustomerName: string;
  relationshipType: string;
};

export type SerializedApprovalListItem = Omit<
  ApprovalListItem,
  "relatedCustomerIds" | "payload"
> & {
  relatedCustomerIds?: string[] | null;
  payload?: Record<string, unknown> | null;
  familyLinkAdminDetail?: FamilyLinkAdminDetail;
};

export function sanitizeApprovalListItemForUser(
  user: { role: string },
  item: ApprovalListItem,
  familyAdminDetails?: Map<string, FamilyLinkAdminDetail>,
): SerializedApprovalListItem {
  if (item.requestType !== "link_family_customer") {
    return item;
  }

  if (user.role === "admin") {
    const detail = familyAdminDetails?.get(item.id);
    return {
      ...item,
      familyLinkAdminDetail: detail,
    };
  }

  const {
    relatedCustomerIds: _relatedCustomerIds,
    payload: _payload,
    ...rest
  } = item;

  return {
    ...rest,
    relatedCustomerIds: null,
    payload: null,
  };
}

export async function loadFamilyLinkAdminDetails(
  db: import("@/lib/db").Database,
  items: ApprovalListItem[],
): Promise<Map<string, FamilyLinkAdminDetail>> {
  const familyItems = items.filter(
    (item) => item.requestType === "link_family_customer",
  );
  const targetIds = [
    ...new Set(
      familyItems
        .map((item) => item.relatedCustomerIds?.[0])
        .filter((id): id is string => !!id),
    ),
  ];

  const details = new Map<string, FamilyLinkAdminDetail>();
  if (targetIds.length === 0) {
    return details;
  }

  const { schema } = await import("@/lib/db");
  const { inArray, eq } = await import("drizzle-orm");

  const customers = await db
    .select({
      id: schema.customers.id,
      customerName: schema.customers.customerName,
    })
    .from(schema.customers)
    .where(inArray(schema.customers.id, targetIds));

  const nameById = new Map(customers.map((row) => [row.id, row.customerName]));

  for (const item of familyItems) {
    const targetId = item.relatedCustomerIds?.[0];
    const relationshipType =
      typeof item.payload?.relationshipType === "string"
        ? item.payload.relationshipType
        : "";
    if (!targetId) continue;
    details.set(item.id, {
      targetCustomerName: nameById.get(targetId) ?? "—",
      relationshipType,
    });
  }

  return details;
}
