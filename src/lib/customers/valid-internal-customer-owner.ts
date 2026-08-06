import { sql, type SQL } from "drizzle-orm";
import { schema } from "@/lib/db";

/**
 * Valid internal customer owner:
 * - user row exists
 * - not soft-deleted
 * - active
 * - role is a legitimate customer-holding internal role (staff | admin)
 *
 * There is no separate system-account role in schema; inactive / soft-deleted
 * users cover service-style and departed accounts for defensive statistics.
 */
export function validInternalCustomerOwnerExistsSql(): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${schema.users} u
    WHERE u.id = ${schema.customers.ownerId}
      AND u.is_active = 1
      AND u.deleted_at IS NULL
      AND u.role IN ('staff', 'admin')
  )`;
}

/** Empty-result guard for illegal Admin ownerId drilldown params. */
export function impossibleCustomerMatchSql(): SQL {
  return sql`1 = 0`;
}
