import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { ARCHIVED_AUDIT_ACTIONS, isArchivedCustomer } from "@/lib/customers/archived";
import {
  assertCustomerNotArchived,
  getCustomerAccessLevel,
  isPublicPoolCustomer,
  PermissionError,
} from "@/lib/permissions/customers";

export function assertCanSubmitApprovalRequest(
  user: User,
  customer: Customer,
): void {
  assertCustomerNotArchived(customer, ARCHIVED_AUDIT_ACTIONS.approvalRequest);

  if (user.role === "admin") {
    return;
  }

  if (isPublicPoolCustomer(customer)) {
    throw new PermissionError(
      403,
      "无权为公共池客户提交申请",
      "approval.request_failed.permission_denied",
    );
  }

  if (getCustomerAccessLevel(user, customer) !== "full") {
    throw new PermissionError(
      403,
      "无权为该客户提交申请",
      "approval.request_failed.permission_denied",
    );
  }

  if (customer.ownerId !== user.id) {
    throw new PermissionError(
      403,
      "只能为自己负责的客户提交申请",
      "approval.request_failed.permission_denied",
    );
  }
}

export function canSubmitApprovalRequest(user: User, customer: Customer): boolean {
  if (isArchivedCustomer(customer)) return false;
  try {
    assertCanSubmitApprovalRequest(user, customer);
    return true;
  } catch {
    return false;
  }
}
