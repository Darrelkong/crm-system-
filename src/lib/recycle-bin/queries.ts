import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { RECYCLE_BIN_RETENTION_DAYS } from "@/lib/recycle-bin/constants";
import { getUserById } from "@/lib/users/queries";
import type { RecycleBinCustomerView } from "@/lib/recycle-bin/types";

export function computeRemainingRetentionDays(
  deletedAt: string,
  now: Date = new Date(),
): number {
  const deletedMs = new Date(deletedAt).getTime();
  const daysSinceDeleted = Math.floor(
    (now.getTime() - deletedMs) / (24 * 60 * 60 * 1000),
  );
  return RECYCLE_BIN_RETENTION_DAYS - daysSinceDeleted;
}

export async function listRecycleBinCustomers(): Promise<RecycleBinCustomerView[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.status, "archived"),
        isNotNull(schema.customers.deletedAt),
      ),
    )
    .orderBy(desc(schema.customers.deletedAt));

  const ownerIds = new Set<string>();
  const deletedByIds = new Set<string>();
  for (const row of rows) {
    if (row.ownerId) ownerIds.add(row.ownerId);
    if (row.deletedBy) deletedByIds.add(row.deletedBy);
  }

  const nameById = new Map<string, string>();
  for (const id of [...ownerIds, ...deletedByIds]) {
    const user = await getUserById(id);
    if (user) nameById.set(id, user.displayName);
  }

  return rows.map((row) => ({
    id: row.id,
    customer_name: row.customerName,
    phone: row.phone,
    email: row.email,
    sales_stage: row.salesStage,
    owner_id: row.ownerId,
    owner_name: row.ownerId ? (nameById.get(row.ownerId) ?? null) : null,
    deleted_at: row.deletedAt!,
    deleted_by: row.deletedBy,
    deleted_by_name: row.deletedBy
      ? (nameById.get(row.deletedBy) ?? null)
      : null,
    deleted_reason: row.deletedReason,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    remaining_retention_days: computeRemainingRetentionDays(row.deletedAt!),
  }));
}
