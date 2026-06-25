import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

export async function getUserById(id: string): Promise<User | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listActiveStaffUsers(): Promise<
  Pick<User, "id" | "displayName" | "email">[]
> {
  const db = getDb();
  return db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.role, "staff"),
        eq(schema.users.isActive, 1),
        isNull(schema.users.deletedAt),
      ),
    );
}

export async function listActiveAdminUsers(): Promise<
  Pick<User, "id" | "displayName" | "email">[]
> {
  const db = getDb();
  return db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.role, "admin"),
        eq(schema.users.isActive, 1),
        isNull(schema.users.deletedAt),
      ),
    );
}
