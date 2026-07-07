import type { ApprovalRequestType } from "../../../drizzle/schema/approvals";

export const MERGE_CUSTOMERS_DISABLED_CODE = "MERGE_CUSTOMERS_DISABLED";

export const MERGE_CUSTOMERS_DISABLED_MESSAGE =
  "客戶合併功能尚未啟用，請勿提交合併申請。";

export function isDisabledMergeCustomersRequestType(
  requestType: string,
): requestType is "merge_customers" {
  return requestType === "merge_customers";
}

/** Approval types shown on customer detail submit modal (merge excluded). */
export const CUSTOMER_DETAIL_APPROVAL_REQUEST_TYPES = [
  "delete_customer",
  "transfer_customer",
  "paid_customer",
] as const satisfies readonly ApprovalRequestType[];
