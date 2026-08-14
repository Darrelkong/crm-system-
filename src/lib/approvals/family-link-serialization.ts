import type { ApprovalListItem } from "./queries";
import { resolveSourcePerspectiveFromSnapshot } from "@/lib/customers/households/family-management-context";

export type FamilyLinkAdminDetail = {
  targetCustomerName: string;
  relationshipType: string;
};

export type FamilyManagementAdminDetail = {
  targetCustomerName: string;
  currentRelationship: string | null;
  requestedRelationship: string | null;
  action: "update_relationship" | "unlink";
};

export type SerializedApprovalListItem = Omit<
  ApprovalListItem,
  "relatedCustomerIds" | "payload"
> & {
  relatedCustomerIds?: string[] | null;
  payload?: Record<string, unknown> | null;
  familyLinkAdminDetail?: FamilyLinkAdminDetail;
  familyManagementAdminDetail?: FamilyManagementAdminDetail;
};

const FAMILY_PRIVACY_REQUEST_TYPES = new Set([
  "link_family_customer",
  "update_family_relationship",
  "unlink_family_customer",
]);

export function sanitizeApprovalListItemForUser(
  user: { role: string },
  item: ApprovalListItem,
  options?: {
    familyLinkAdminDetails?: Map<string, FamilyLinkAdminDetail>;
    familyManagementAdminDetails?: Map<string, FamilyManagementAdminDetail>;
  },
): SerializedApprovalListItem {
  if (!FAMILY_PRIVACY_REQUEST_TYPES.has(item.requestType)) {
    return item;
  }

  if (user.role === "admin") {
    if (item.requestType === "link_family_customer") {
      return {
        ...item,
        familyLinkAdminDetail: options?.familyLinkAdminDetails?.get(item.id),
      };
    }

    return {
      ...item,
      familyManagementAdminDetail: options?.familyManagementAdminDetails?.get(
        item.id,
      ),
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
  const { inArray } = await import("drizzle-orm");

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

export async function loadFamilyManagementAdminDetails(
  db: import("@/lib/db").Database,
  items: ApprovalListItem[],
): Promise<Map<string, FamilyManagementAdminDetail>> {
  const familyItems = items.filter(
    (item) =>
      item.requestType === "update_family_relationship" ||
      item.requestType === "unlink_family_customer",
  );

  const targetIds = [
    ...new Set(
      familyItems
        .map((item) => item.relatedCustomerIds?.[0])
        .filter((id): id is string => !!id),
    ),
  ];

  const details = new Map<string, FamilyManagementAdminDetail>();
  if (targetIds.length === 0) {
    return details;
  }

  const { schema } = await import("@/lib/db");
  const { inArray } = await import("drizzle-orm");

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
    if (!targetId) continue;

    const payload = item.payload ?? {};
    const currentRelationship = resolveSourcePerspectiveFromSnapshot(payload);
    const requestedRelationship =
      item.requestType === "update_family_relationship" &&
      typeof payload.requestedRelationshipType === "string"
        ? payload.requestedRelationshipType
        : null;

    details.set(item.id, {
      targetCustomerName: nameById.get(targetId) ?? "—",
      currentRelationship,
      requestedRelationship,
      action:
        item.requestType === "unlink_family_customer"
          ? "unlink"
          : "update_relationship",
    });
  }

  return details;
}
