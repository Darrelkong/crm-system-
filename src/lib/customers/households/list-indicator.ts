import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";

/**
 * Returns customer IDs from the input set that qualify for the Family Customer
 * list icon: active household membership with at least one other active,
 * non-soft-deleted member. Does not query relationship rows.
 */
export async function getCustomerIdsWithHouseholdIcon(
  db: Database,
  customerIds: readonly string[],
): Promise<Set<string>> {
  if (customerIds.length === 0) {
    return new Set();
  }

  const rows = await db
    .select({ customerId: schema.customerHouseholdMembers.customerId })
    .from(schema.customerHouseholdMembers)
    .innerJoin(
      schema.customerHouseholds,
      eq(
        schema.customerHouseholds.id,
        schema.customerHouseholdMembers.householdId,
      ),
    )
    .innerJoin(
      schema.customers,
      eq(schema.customers.id, schema.customerHouseholdMembers.customerId),
    )
    .where(
      and(
        inArray(schema.customerHouseholdMembers.customerId, [...customerIds]),
        isNull(schema.customerHouseholdMembers.leftAt),
        eq(schema.customerHouseholds.status, "active"),
        isNull(schema.customers.deletedAt),
        sql`EXISTS (
          SELECT 1
          FROM ${schema.customerHouseholdMembers} other
          INNER JOIN ${schema.customers} other_customer
            ON other_customer.id = other.customer_id
          WHERE other.household_id = ${schema.customerHouseholdMembers.householdId}
            AND other.left_at IS NULL
            AND other.customer_id != ${schema.customerHouseholdMembers.customerId}
            AND other_customer.deleted_at IS NULL
        )`,
      ),
    );

  return new Set(rows.map((row) => row.customerId));
}
