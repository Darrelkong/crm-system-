import type { Database } from "@/lib/db";
import { PermissionError } from "@/lib/permissions/customers";
import {
  assertCustomerNotPendingOnHoldCreate,
  PENDING_ON_HOLD_CREATE_AUDIT_ACTION,
} from "@/lib/customers/pending-on-hold-access";

export async function blockPendingOnHoldCreateCustomer(
  db: Database,
  customerId: string,
): Promise<Response | null> {
  try {
    await assertCustomerNotPendingOnHoldCreate(db, customerId);
    return null;
  } catch (err) {
    if (err instanceof PermissionError) {
      return Response.json(
        {
          error: err.message,
          errorCode: "PENDING_ON_HOLD_CREATE",
        },
        { status: 403 },
      );
    }
    throw err;
  }
}

export { PENDING_ON_HOLD_CREATE_AUDIT_ACTION };
