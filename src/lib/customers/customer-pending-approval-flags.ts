import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { ApprovalRequestType } from "../../../drizzle/schema/approvals";

export const CUSTOMER_DETAIL_PENDING_APPROVAL_TYPES = [
  "create_on_hold_customer",
  "set_priority_customer",
  "unset_priority_customer",
] as const satisfies readonly ApprovalRequestType[];

export type CustomerPendingApprovalFlags = {
  pendingOnHoldCreate: boolean;
  pendingPriority: boolean;
};

export async function getCustomerPendingApprovalFlags(
  db: Database,
  customerId: string,
): Promise<CustomerPendingApprovalFlags> {
  const rows = await db
    .select({ requestType: schema.approvals.requestType })
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.customerId, customerId),
        eq(schema.approvals.status, "pending"),
        inArray(
          schema.approvals.requestType,
          [...CUSTOMER_DETAIL_PENDING_APPROVAL_TYPES],
        ),
      ),
    );

  let pendingOnHoldCreate = false;
  let pendingPriority = false;
  for (const row of rows) {
    if (row.requestType === "create_on_hold_customer") {
      pendingOnHoldCreate = true;
    }
    if (
      row.requestType === "set_priority_customer" ||
      row.requestType === "unset_priority_customer"
    ) {
      pendingPriority = true;
    }
  }

  return { pendingOnHoldCreate, pendingPriority };
}
