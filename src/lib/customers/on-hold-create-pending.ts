/** Staff create with on_hold requires admin approval (D-1b-2). */
export function isStaffOnHoldCreatePending(
  role: string,
  salesStage: string | undefined,
): boolean {
  return role !== "admin" && salesStage === "on_hold";
}

/** Sales stage persisted on customer row before on_hold approval. */
export function resolvePersistedSalesStageForCreate(
  role: string,
  salesStage: string,
): string {
  return isStaffOnHoldCreatePending(role, salesStage) ? "new_lead" : salesStage;
}

export const ON_HOLD_CREATE_APPROVAL_TYPE = "create_on_hold_customer" as const;

export const ON_HOLD_REASON_MIN_LENGTH = 8;

export type OnHoldReasonValidationError =
  | "ON_HOLD_REASON_REQUIRED"
  | "ON_HOLD_REASON_TOO_SHORT";

export function validateOnHoldReason(
  onHoldReason: unknown,
): { ok: true; value: string } | { ok: false; errorCode: OnHoldReasonValidationError } {
  const trimmed =
    typeof onHoldReason === "string" ? onHoldReason.trim() : "";

  if (!trimmed) {
    return { ok: false, errorCode: "ON_HOLD_REASON_REQUIRED" };
  }

  if (trimmed.length < ON_HOLD_REASON_MIN_LENGTH) {
    return { ok: false, errorCode: "ON_HOLD_REASON_TOO_SHORT" };
  }

  return { ok: true, value: trimmed };
}

export type OnHoldCreateApprovalPayloadInput = {
  requestedSalesStage: string;
  onHoldReason: string;
  customerName: string;
  customerType: string;
  phoneCountryCode: string;
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
  source: string;
  sourceRemark?: string | null;
  requestedProjectName?: string | null;
  notes?: string | null;
};

export function buildOnHoldCreateApprovalPayload(
  input: OnHoldCreateApprovalPayloadInput,
): Record<string, unknown> {
  return {
    requestedSalesStage: input.requestedSalesStage,
    targetSalesStage: input.requestedSalesStage,
    onHoldReason: input.onHoldReason,
    customerName: input.customerName,
    customerType: input.customerType,
    phoneCountryCode: input.phoneCountryCode,
    phone: input.phone ?? null,
    wechatId: input.wechatId ?? null,
    email: input.email ?? null,
    source: input.source,
    sourceRemark: input.sourceRemark ?? null,
    requestedProjectName: input.requestedProjectName ?? null,
    notes: input.notes ?? null,
  };
}

export type ParsedOnHoldCreateApprovalPayload = {
  requestedSalesStage: string;
  targetSalesStage: string;
  onHoldReason: string | null;
  customerName: string | null;
  customerType: string | null;
  phoneCountryCode: string | null;
  phone: string | null;
  wechatId: string | null;
  email: string | null;
  source: string | null;
  sourceRemark: string | null;
  requestedProjectName: string | null;
  notes: string | null;
};

export function parseOnHoldCreateApprovalPayload(
  payload: Record<string, unknown> | null | undefined,
): ParsedOnHoldCreateApprovalPayload {
  const p = payload ?? {};
  return {
    requestedSalesStage:
      typeof p.requestedSalesStage === "string" ? p.requestedSalesStage : "on_hold",
    targetSalesStage:
      typeof p.targetSalesStage === "string" ? p.targetSalesStage : "on_hold",
    onHoldReason:
      typeof p.onHoldReason === "string"
        ? p.onHoldReason
        : typeof p.onHoldReason === "number"
          ? String(p.onHoldReason)
          : null,
    customerName: typeof p.customerName === "string" ? p.customerName : null,
    customerType: typeof p.customerType === "string" ? p.customerType : null,
    phoneCountryCode:
      typeof p.phoneCountryCode === "string" ? p.phoneCountryCode : null,
    phone: typeof p.phone === "string" ? p.phone : null,
    wechatId: typeof p.wechatId === "string" ? p.wechatId : null,
    email: typeof p.email === "string" ? p.email : null,
    source: typeof p.source === "string" ? p.source : null,
    sourceRemark: typeof p.sourceRemark === "string" ? p.sourceRemark : null,
    requestedProjectName:
      typeof p.requestedProjectName === "string" ? p.requestedProjectName : null,
    notes: typeof p.notes === "string" ? p.notes : null,
  };
}

export function formatPhoneForDisplay(
  phoneCountryCode: string | null,
  phone: string | null,
): string {
  const code = phoneCountryCode?.trim() ?? "";
  const number = phone?.trim() ?? "";
  const combined = [code, number].filter(Boolean).join(" ").trim();
  return combined || "—";
}

export function displayOrDash(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}
