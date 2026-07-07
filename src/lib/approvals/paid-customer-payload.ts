export type PaidCustomerFormInput = {
  serviceItems: string;
  paidAmount: string;
  paidAt: string;
  remarks?: string;
};

export type PaidCustomerFormFieldError = {
  field: string;
  message: string;
};

export function buildPaidCustomerApprovalPayload(
  input: PaidCustomerFormInput,
): Record<string, string> {
  const payload: Record<string, string> = {
    serviceItems: input.serviceItems.trim(),
    paidAmount: input.paidAmount.trim(),
    paidAt: input.paidAt.trim(),
  };

  const remarks = input.remarks?.trim();
  if (remarks) {
    payload.remarks = remarks;
  }

  return payload;
}

export function validatePaidCustomerFormClient(
  input: PaidCustomerFormInput,
): { ok: true } | { ok: false; errors: PaidCustomerFormFieldError[] } {
  const errors: PaidCustomerFormFieldError[] = [];

  if (!input.serviceItems.trim()) {
    errors.push({ field: "serviceItems", message: "已付款服务项目必填" });
  }

  const paidAmount = input.paidAmount.trim();
  if (!paidAmount) {
    errors.push({ field: "paidAmount", message: "付款金额必填" });
  } else {
    const amount = Number(paidAmount);
    if (isNaN(amount) || amount <= 0) {
      errors.push({ field: "paidAmount", message: "付款金额必须大于 0" });
    }
  }

  if (!input.paidAt.trim()) {
    errors.push({ field: "paidAt", message: "付款时间必填" });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}
