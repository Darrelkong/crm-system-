import { asc, eq, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

const followUpSort = [
  sql`CASE WHEN ${schema.customers.lastValidFollowUpAt} IS NULL THEN 0 ELSE 1 END`,
  asc(schema.customers.lastValidFollowUpAt),
  asc(schema.customers.createdAt),
];

export async function listCustomersForUser(user: User, limit = 100) {
  const db = getDb();

  if (user.role === "admin") {
    return db
      .select()
      .from(schema.customers)
      .orderBy(...followUpSort)
      .limit(limit);
  }

  return db
    .select()
    .from(schema.customers)
    .where(
      or(
        eq(schema.customers.ownerId, user.id),
        eq(schema.customers.status, "public_pool"),
        isNull(schema.customers.ownerId),
      ),
    )
    .orderBy(...followUpSort)
    .limit(limit);
}

export async function getCustomerById(id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, id))
    .limit(1);
  return rows[0] ?? null;
}
