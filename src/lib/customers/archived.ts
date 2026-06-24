import type { Customer } from "../../../drizzle/schema/customers";

export const ARCHIVED_CUSTOMER_MESSAGE = "该客户已归档，不能继续操作";

export const ARCHIVED_AUDIT_ACTIONS = {
  update: "customer.update_failed.archived",
  followUpCreate: "follow_up.create_failed.archived",
  releaseToPool: "customer.release_to_pool_failed.archived",
  approvalRequest: "approval.request_failed.archived",
} as const;

export function isArchivedCustomer(customer: Customer): boolean {
  return customer.status === "archived";
}
