import {
  APPROVAL_REQUEST_TYPES,
  type ApprovalRequestType,
} from "../../../drizzle/schema/approvals";
import {
  MERGE_CUSTOMERS_DISABLED_CODE,
  MERGE_CUSTOMERS_DISABLED_MESSAGE,
  isDisabledMergeCustomersRequestType,
} from "./errors";

export type FieldError = { field: string; message: string; code?: string };

export type ValidatedApprovalRequest = {
  requestType: ApprovalRequestType;
  reason: string;
  targetUserId?: string;
  relatedCustomerIds?: string[];
  payload?: Record<string, unknown>;
};

export type ApprovalRequestInput = {
  requestType: string;
  reason?: string;
  targetUserId?: string;
  relatedCustomerIds?: string[];
  payload?: Record<string, unknown>;
};

const REQUEST_TYPES: ApprovalRequestType[] = [...APPROVAL_REQUEST_TYPES];

export function isApprovalRequestType(v: string): v is ApprovalRequestType {
  return (REQUEST_TYPES as readonly string[]).includes(v);
}

export function validateApprovalRequestInput(
  input: ApprovalRequestInput,
): { ok: true; value: ValidatedApprovalRequest } | { ok: false; fieldErrors: FieldError[] } {
  const fieldErrors: FieldError[] = [];

  if (!input.requestType || !isApprovalRequestType(input.requestType)) {
    fieldErrors.push({ field: "requestType", message: "无效的申请类型" });
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) {
    fieldErrors.push({ field: "reason", message: "申请原因必填" });
  }

  if (fieldErrors.length > 0 || !isApprovalRequestType(input.requestType)) {
    return { ok: false, fieldErrors };
  }

  const requestType = input.requestType;

  if (isDisabledMergeCustomersRequestType(requestType)) {
    fieldErrors.push({
      field: "requestType",
      message: MERGE_CUSTOMERS_DISABLED_MESSAGE,
      code: MERGE_CUSTOMERS_DISABLED_CODE,
    });
    return { ok: false, fieldErrors };
  }

  if (requestType === "transfer_customer") {
    if (!input.targetUserId?.trim()) {
      fieldErrors.push({ field: "targetUserId", message: "转移目标员工必填" });
    }
  }

  if (requestType === "closed_won") {
    const payload = input.payload ?? {};
    if (payload.dealAmount === undefined || payload.dealAmount === null || payload.dealAmount === "") {
      fieldErrors.push({ field: "dealAmount", message: "成交金额必填" });
    }
    if (!payload.signingDate || typeof payload.signingDate !== "string") {
      fieldErrors.push({ field: "signingDate", message: "签约日期必填" });
    }
  }

  if (fieldErrors.length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: {
      requestType,
      reason,
      targetUserId: input.targetUserId?.trim(),
      relatedCustomerIds: input.relatedCustomerIds,
      payload: input.payload,
    },
  };
}
