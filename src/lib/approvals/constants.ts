import type { ApprovalRequestType } from "../../../drizzle/schema/approvals";

export const APPROVAL_REQUEST_TYPE_LABELS: Record<ApprovalRequestType, string> = {
  delete_customer: "删除客户",
  transfer_customer: "转移客户",
  merge_customers: "合并客户",
  closed_won: "成交申请",
  second_conversion: "二次转化",
  create_on_hold_customer: "申请新增搁置客户",
  update_customer_assignees: "调整负责员工",
};

export const APPROVAL_STATUS_LABELS = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
} as const;

export const APPROVAL_AUDIT_ACTIONS = {
  requested: "approval.requested",
  requestFailedValidation: "approval.request_failed.validation",
  requestFailedPermission: "approval.request_failed.permission_denied",
  approved: "approval.approved",
  rejected: "approval.rejected",
  customerTransferred: "customer.transferred",
  customerClosedWonApproved: "customer.closed_won.approved",
  customerDeletedSoft: "customer.deleted.soft",
  mergeApprovedPlaceholder: "approval.merge.approved_placeholder",
  secondConversionApproved: "approval.second_conversion.approved",
  customerOnHoldCreateApproved: "customer.on_hold_create.approved",
  customerOnHoldCreateRejected: "customer.on_hold_create.rejected",
  customerAssigneesUpdatedViaApproval: "customer.assignees.updated_via_approval",
} as const;

export const APPROVAL_NOTIFICATION_TITLES = {
  pending: "待审批申请",
  approved: "申请已通过",
  rejected: "申请已驳回",
  transferred: "客户已转移",
  closedWon: "成交申请已通过",
} as const;
