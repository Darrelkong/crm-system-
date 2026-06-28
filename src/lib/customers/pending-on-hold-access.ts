import type { Database } from "@/lib/db";
import { PermissionError } from "@/lib/permissions/customers";
import type { Approval } from "../../../drizzle/schema/approvals";
import { findPendingApproval } from "@/lib/approvals/queries";
import {
  ON_HOLD_CREATE_APPROVAL_TYPE,
  parseOnHoldCreateApprovalPayload,
} from "./on-hold-create-pending";

export const PENDING_ON_HOLD_CREATE_MESSAGE =
  "该客户正在等待搁置审核，请等待管理员审批。";

export const PENDING_ON_HOLD_CREATE_AUDIT_ACTION =
  "permission.denied.pending_on_hold_create";

export async function getPendingOnHoldCreateApprovalForCustomer(
  db: Database,
  customerId: string,
): Promise<Approval | null> {
  return findPendingApproval(db, customerId, ON_HOLD_CREATE_APPROVAL_TYPE);
}

export async function assertCustomerNotPendingOnHoldCreate(
  db: Database,
  customerId: string,
): Promise<void> {
  const pending = await getPendingOnHoldCreateApprovalForCustomer(
    db,
    customerId,
  );
  if (pending) {
    throw new PermissionError(
      403,
      PENDING_ON_HOLD_CREATE_MESSAGE,
      PENDING_ON_HOLD_CREATE_AUDIT_ACTION,
    );
  }
}

export type OnHoldCreateApprovedCustomerUpdate = {
  salesStage: "on_hold";
  isPinned: 1;
  pinnedAt: string;
  updatedAt: string;
};

export function buildOnHoldCreateApprovedCustomerUpdate(
  now: string,
): OnHoldCreateApprovedCustomerUpdate {
  return {
    salesStage: "on_hold",
    isPinned: 1,
    pinnedAt: now,
    updatedAt: now,
  };
}

export function resolveOnHoldReasonFromApproval(
  approval: Pick<Approval, "reason" | "payload">,
): string {
  const fromReason = approval.reason?.trim();
  if (fromReason) {
    return fromReason;
  }

  let payload: Record<string, unknown> | null = null;
  if (approval.payload) {
    try {
      const parsed = JSON.parse(approval.payload) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = null;
    }
  }

  return parseOnHoldCreateApprovalPayload(payload).onHoldReason?.trim() ?? "";
}

export function buildOnHoldCreateApprovedAuditMetadata(input: {
  approvalId: string;
  customerName: string;
  requestedBy: string;
  requestedByName: string;
  onHoldReason: string;
}): Record<string, unknown> {
  return {
    approvalId: input.approvalId,
    customerName: input.customerName,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    onHoldReason: input.onHoldReason,
  };
}

export function buildOnHoldCreateRejectedAuditMetadata(input: {
  approvalId: string;
  customerName: string;
  requestedBy: string;
  adminComment?: string | null;
}): Record<string, unknown> {
  return {
    approvalId: input.approvalId,
    customerName: input.customerName,
    requestedBy: input.requestedBy,
    adminComment: input.adminComment?.trim() || null,
  };
}
