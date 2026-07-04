import { and, count, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { Approval, ApprovalStatus } from "../../../drizzle/schema/approvals";
import type { User } from "../../../drizzle/schema/users";

export type ApprovalListItem = {
  id: string;
  requestType: Approval["requestType"];
  status: ApprovalStatus;
  customerId: string;
  customerName: string;
  requestedBy: string;
  requestedByName: string;
  targetUserId: string | null;
  targetUserName: string | null;
  relatedCustomerIds: string[] | null;
  payload: Record<string, unknown> | null;
  reason: string;
  adminComment: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function parseJsonArray(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function getApprovalById(
  db: Database,
  id: string,
): Promise<Approval | null> {
  const rows = await db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function findPendingApproval(
  db: Database,
  customerId: string,
  requestType: Approval["requestType"],
): Promise<Approval | null> {
  const rows = await db
    .select()
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.customerId, customerId),
        eq(schema.approvals.requestType, requestType),
        eq(schema.approvals.status, "pending"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Count pending approvals visible to the user.
 * Admin: all pending approvals.
 * Staff: only approvals they submitted that are still pending.
 * Approved / rejected are never counted.
 */
export async function getPendingApprovalCountForUser(
  db: Database,
  user: Pick<User, "id" | "role">,
): Promise<number> {
  const filters = [eq(schema.approvals.status, "pending")];
  if (user.role !== "admin") {
    filters.push(eq(schema.approvals.requestedBy, user.id));
  }
  const row = await db
    .select({ value: count() })
    .from(schema.approvals)
    .where(and(...filters));
  return row[0]?.value ?? 0;
}

export async function listApprovalsForUser(
  db: Database,
  user: User,
  statusFilter?: ApprovalStatus | "all",
): Promise<ApprovalListItem[]> {
  const filters = [];
  if (user.role !== "admin") {
    filters.push(eq(schema.approvals.requestedBy, user.id));
  }
  if (statusFilter && statusFilter !== "all") {
    filters.push(eq(schema.approvals.status, statusFilter));
  }

  const baseQuery = db
    .select({
      approval: schema.approvals,
      customerName: schema.customers.customerName,
      requestedByName: schema.users.displayName,
    })
    .from(schema.approvals)
    .innerJoin(
      schema.customers,
      eq(schema.approvals.customerId, schema.customers.id),
    )
    .innerJoin(
      schema.users,
      eq(schema.approvals.requestedBy, schema.users.id),
    );

  const rows =
    filters.length === 0
      ? await baseQuery
      : filters.length === 1
        ? await baseQuery.where(filters[0])
        : await baseQuery.where(and(...filters));

  const targetUserIds = [
    ...new Set(
      rows
        .map((row) => row.approval.targetUserId)
        .filter((id): id is string => !!id),
    ),
  ];

  const targetUsers =
    targetUserIds.length > 0
      ? await db
          .select({
            id: schema.users.id,
            displayName: schema.users.displayName,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, targetUserIds))
      : [];

  const targetNameById = new Map(
    targetUsers.map((u) => [u.id, u.displayName] as const),
  );

  const items: ApprovalListItem[] = rows.map((row) => ({
    id: row.approval.id,
    requestType: row.approval.requestType,
    status: row.approval.status,
    customerId: row.approval.customerId,
    customerName: row.customerName,
    requestedBy: row.approval.requestedBy,
    requestedByName: row.requestedByName,
    targetUserId: row.approval.targetUserId,
    targetUserName: row.approval.targetUserId
      ? (targetNameById.get(row.approval.targetUserId) ?? null)
      : null,
    relatedCustomerIds: parseJsonArray(row.approval.relatedCustomerIds),
    payload: parseJsonObject(row.approval.payload),
    reason: row.approval.reason,
    adminComment: row.approval.adminComment,
    reviewedBy: row.approval.reviewedBy,
    reviewedAt: row.approval.reviewedAt,
    createdAt: row.approval.createdAt,
    updatedAt: row.approval.updatedAt,
  }));

  items.sort((a, b) => {
    const statusOrder = { pending: 0, approved: 1, rejected: 2 } as const;
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return items;
}
