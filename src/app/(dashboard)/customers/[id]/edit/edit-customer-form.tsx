"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, Select, Label, Field } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import {
  buildEditFormSalesStageOptions,
  CUSTOMER_TYPES,
  isDirectCreateBlockedSalesStage,
} from "@/lib/constants/customer-fields";
import type { CustomerType } from "@/lib/constants/customer-fields";
import type { CustomerTagOption } from "@/lib/customer-tags/types";
import type { ValidationFieldError } from "@/lib/customers/validation";
import { validateCustomerInput } from "@/lib/customers/validation";
import {
  buildPaidCustomerApprovalRequestBody,
  requiresPaidCustomerApprovalOnEdit,
  validatePaidCustomerFormClient,
} from "@/lib/approvals/paid-customer-payload";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError, resolveFieldError } from "@/i18n/resolve-api-error";
import { ui } from "@/lib/ui/classes";

type DuplicateMatch = {
  field: string;
  customer:
    | { isMasked: true }
    | { isMasked: false; id: string; customerName: string; status: string };
};

const COUNTRY_CODES = ["+86", "+852", "+853", "+886", "+1", "+44", "+81"];

const EDITABLE_STATUS_KEYS = ["active", "inactive", "archived"] as const;

const STAFF_LOCKED_SENSITIVE_FIELDS = new Set([
  "customerName",
  "customerType",
  "source",
  "requestedProjectName",
  "phoneCountryCode",
  "phone",
  "wechatId",
  "email",
  "notes",
]);

const lockedFieldClassName =
  "cursor-not-allowed bg-[#F7FAFD] text-[#6B7890] opacity-90";

export type EditCustomerInitial = {
  id: string;
  customerName: string;
  customerType: CustomerType;
  phoneCountryCode: string;
  phone: string;
  wechatId: string;
  email: string;
  source: string;
  sourceRemark: string;
  requestedProjectName: string;
  notes: string;
  salesStage: string;
  status: string;
};

export function EditCustomerForm({
  initial,
  tags,
  canEditStatus = false,
  isStaff = false,
}: {
  initial: EditCustomerInitial;
  tags: CustomerTagOption[];
  canEditStatus?: boolean;
  isStaff?: boolean;
}) {
  const router = useRouter();
  const { t, salesStage, customerType, status, fieldLabel } = useCustomerLabels();
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [paidModalOpen, setPaidModalOpen] = useState(false);
  const [paidServiceItems, setPaidServiceItems] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [paidRemarks, setPaidRemarks] = useState("");
  const [paidModalError, setPaidModalError] = useState<string | null>(null);
  const [paidSubmitting, setPaidSubmitting] = useState(false);

  const isPublicPool = initial.status === "public_pool";
  const showStatusDropdown = canEditStatus && !isPublicPool;
  const lockSensitiveFields = isStaff;

  const salesStageOptions = buildEditFormSalesStageOptions({
    isStaff,
    currentSalesStage: initial.salesStage,
  });

  const [form, setForm] = useState({
    customerName: initial.customerName,
    customerType: initial.customerType,
    phoneCountryCode: initial.phoneCountryCode,
    phone: initial.phone,
    wechatId: initial.wechatId,
    email: initial.email,
    source: initial.source,
    sourceRemark: initial.sourceRemark,
    requestedProjectName: initial.requestedProjectName,
    notes: initial.notes,
    salesStage: initial.salesStage,
    status: initial.status,
  });

  function set(field: string, value: string) {
    if (lockSensitiveFields && STAFF_LOCKED_SENSITIVE_FIELDS.has(field)) {
      return;
    }
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      if (field === "phone" || field === "wechatId") delete next["phone"];
      return next;
    });
    setServerError(null);
    setDuplicates(null);
  }

  function closePaidApprovalModal() {
    setPaidModalOpen(false);
    setPaidModalError(null);
    setPaidServiceItems("");
    setPaidAmount("");
    setPaidAt("");
    setPaidRemarks("");
    setForm((prev) => ({ ...prev, salesStage: initial.salesStage }));
  }

  async function handlePaidApprovalSubmit() {
    setPaidSubmitting(true);
    setPaidModalError(null);

    const validation = validatePaidCustomerFormClient({
      serviceItems: paidServiceItems,
      paidAmount,
      paidAt,
      remarks: paidRemarks,
    });
    if (!validation.ok) {
      setPaidModalError(validation.errors.map((e) => e.message).join(" · "));
      setPaidSubmitting(false);
      return;
    }

    const body = buildPaidCustomerApprovalRequestBody({
      reason: t("customers.paidApprovalEditDefaultReason"),
      serviceItems: paidServiceItems,
      paidAmount,
      paidAt,
      remarks: paidRemarks,
    });

    try {
      const res = await fetch(`/api/customers/${initial.id}/approval-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        error?: string;
        errorCode?: string;
        fieldErrors?: ValidationFieldError[];
      };

      if (res.ok) {
        setPaidModalOpen(false);
        setForm((prev) => ({ ...prev, salesStage: initial.salesStage }));
        router.push(`/customers/${initial.id}`);
        return;
      }

      if (data.fieldErrors?.length) {
        setPaidModalError(data.fieldErrors.map((e) => resolveFieldError(t, e)).join(" · "));
        return;
      }

      setPaidModalError(resolveApiError(t, data));
    } catch {
      setPaidModalError(t("common.networkError"));
    } finally {
      setPaidSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setServerError(null);
    setDuplicates(null);

    if (requiresPaidCustomerApprovalOnEdit(form.salesStage, initial.salesStage)) {
      setPaidModalOpen(true);
      setSubmitting(false);
      return;
    }

    const validationErrors = validateCustomerInput(form, {
      isUpdate: true,
      existingNotes: initial.notes,
      existingSalesStage: initial.salesStage,
      allowedSourceKeys: tags.map((tag) => tag.tagKey),
      userRole: isStaff ? "staff" : "admin",
    });
    if (validationErrors.length > 0) {
      const errs: Record<string, string> = {};
      for (const fe of validationErrors) errs[fe.field] = resolveFieldError(t, fe);
      setFieldErrors(errs);
      setSubmitting(false);
      return;
    }

    try {
      const { status: _status, ...fieldsWithoutStatus } = form;
      const submitBody = showStatusDropdown ? form : fieldsWithoutStatus;

      const res = await fetch(`/api/customers/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitBody),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        errorCode?: string;
        fieldErrors?: ValidationFieldError[];
        code?: string;
        duplicates?: DuplicateMatch[];
      };

      if (res.ok) {
        router.push(`/customers/${initial.id}`);
        return;
      }

      if (res.status === 400 && data.fieldErrors) {
        const errs: Record<string, string> = {};
        for (const fe of data.fieldErrors) errs[fe.field] = resolveFieldError(t, fe);
        setFieldErrors(errs);
        return;
      }

      if (res.status === 409 && data.code === "duplicate_customer") {
        setDuplicates(data.duplicates ?? []);
        setServerError(t("customers.duplicateFound"));
        return;
      }

      setServerError(resolveApiError(t, data));
    } catch {
      setServerError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-2xl">
      {serverError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-700">{serverError}</p>
          {duplicates && duplicates.length > 0 && (
            <ul className="mt-2 space-y-1">
              {duplicates.map((d, i) => (
                <li key={i} className="text-sm text-red-600">
                  {t("customers.fieldExists", { field: fieldLabel(d.field) })}
                  {d.customer.isMasked ? (
                    <span className="ml-1">
                      {t("customers.maskedDuplicateHint")}
                    </span>
                  ) : (
                    <a
                      href={`/customers/${d.customer.id}`}
                      className="ml-1 font-medium underline hover:text-red-800"
                    >
                      {d.customer.customerName}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {lockSensitiveFields && (
        <div
          className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="note"
        >
          {t("customers.sensitiveFieldsLockedHint")}
        </div>
      )}

      <div className="surface-card p-6">
        <h3 className="mb-4 text-base font-semibold text-[#172033]">
          {t("customers.basicSection")}
        </h3>

        <Field>
          <Label htmlFor="customerName">
            {t("customers.clientName")} <span className="text-red-500">*</span>
          </Label>
          <Input
            id="customerName"
            value={form.customerName}
            onChange={(e) => set("customerName", e.target.value)}
            disabled={lockSensitiveFields}
            className={lockSensitiveFields ? lockedFieldClassName : undefined}
          />
          {fieldErrors.customerName && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.customerName}</p>
          )}
        </Field>

        <Field>
          <Label htmlFor="requestedProjectName">
            {t("customers.requestedProjectName")}{" "}
            <span className="text-red-500">*</span>
          </Label>
          <Input
            id="requestedProjectName"
            value={form.requestedProjectName}
            onChange={(e) => set("requestedProjectName", e.target.value)}
            placeholder={t("customers.requestedProjectNamePlaceholder")}
            disabled={lockSensitiveFields}
            className={lockSensitiveFields ? lockedFieldClassName : undefined}
          />
          {fieldErrors.requestedProjectName && (
            <p className="mt-1 text-xs text-red-600">
              {fieldErrors.requestedProjectName}
            </p>
          )}
        </Field>

        <Field>
          <Label htmlFor="customerType">{t("customers.clientType")}</Label>
          <Select
            id="customerType"
            value={form.customerType}
            onChange={(e) => set("customerType", e.target.value)}
            disabled={lockSensitiveFields}
            className={lockSensitiveFields ? lockedFieldClassName : undefined}
          >
            {CUSTOMER_TYPES.map((typeKey) => (
              <option key={typeKey} value={typeKey}>
                {customerType(typeKey)}
              </option>
            ))}
          </Select>
        </Field>

        <Field>
          <Label htmlFor="status">{t("customers.status")}</Label>
          {showStatusDropdown ? (
            <Select
              id="status"
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              {EDITABLE_STATUS_KEYS.map((s) => (
                <option key={s} value={s}>
                  {status(s)}
                </option>
              ))}
            </Select>
          ) : (
            <p
              id="status"
              className="surface-muted px-3 py-2 text-sm text-[#172033]"
            >
              {status(form.status)}
            </p>
          )}
          {showStatusDropdown && (
            <p className="mt-1 text-xs text-[#6B7890]">
              {t("customers.useReleaseFlowForPublicPool")}
            </p>
          )}
          {canEditStatus && isPublicPool && (
            <p className="mt-1 text-xs text-[#6B7890]">
              {t("customers.publicPoolStatusReadOnly")}
            </p>
          )}
          {fieldErrors.status && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.status}</p>
          )}
        </Field>

        <div className="mb-4">
          <Label>
            {t("customers.phoneWechatRequired")}{" "}
            <span className="text-red-500">*</span>
            <span className="ml-1 text-xs font-normal text-[#6B7890]">
              {t("customers.atLeastOne")}
            </span>
          </Label>
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
            <Select
              className={`w-full${lockSensitiveFields ? ` ${lockedFieldClassName}` : ""}`}
              value={form.phoneCountryCode}
              onChange={(e) => set("phoneCountryCode", e.target.value)}
              disabled={lockSensitiveFields}
            >
              {COUNTRY_CODES.map((cc) => (
                <option key={cc} value={cc}>
                  {cc}
                </option>
              ))}
            </Select>
            <Input
              className={`min-w-0 w-full${lockSensitiveFields ? ` ${lockedFieldClassName}` : ""}`}
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder={t("customers.phonePlaceholder")}
              type="tel"
              disabled={lockSensitiveFields}
            />
          </div>
          {fieldErrors.phone && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>
          )}
          <div className="mt-2">
            <Input
              value={form.wechatId}
              onChange={(e) => set("wechatId", e.target.value)}
              placeholder={t("customers.wechatOptional")}
              disabled={lockSensitiveFields}
              className={lockSensitiveFields ? lockedFieldClassName : undefined}
            />
          </div>
        </div>

        <Field>
          <Label htmlFor="email">{t("customers.email")}</Label>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder={t("customers.emailOptional")}
            disabled={lockSensitiveFields}
            className={lockSensitiveFields ? lockedFieldClassName : undefined}
          />
          {fieldErrors.email && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>
          )}
        </Field>
      </div>

      <div className="surface-card mt-4 p-6">
        <h3 className="mb-4 text-base font-semibold text-[#172033]">
          {t("customers.sourceAndStage")}
        </h3>

        <Field>
          <Label htmlFor="source">
            {t("customers.source")} <span className="text-red-500">*</span>
          </Label>
          <Select
            id="source"
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
            disabled={lockSensitiveFields}
            className={lockSensitiveFields ? lockedFieldClassName : undefined}
          >
            {tags.map((tag) => (
              <option key={tag.tagKey} value={tag.tagKey}>
                {tag.label}
              </option>
            ))}
          </Select>
          {fieldErrors.source && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.source}</p>
          )}
        </Field>

        {form.source === "other" && (
          <Field>
            <Label htmlFor="sourceRemark">
              {t("customers.sourceRemark")} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="sourceRemark"
              value={form.sourceRemark}
              onChange={(e) => set("sourceRemark", e.target.value)}
            />
            {fieldErrors.sourceRemark && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.sourceRemark}</p>
            )}
          </Field>
        )}

        <Field>
          <Label htmlFor="salesStage">{t("customers.salesStage")}</Label>
          <Select
            id="salesStage"
            value={form.salesStage}
            onChange={(e) => set("salesStage", e.target.value)}
          >
            {salesStageOptions.map((s) => (
              <option
                key={s}
                value={s}
                disabled={
                  isStaff &&
                  isDirectCreateBlockedSalesStage(s) &&
                  s !== form.salesStage
                }
              >
                {salesStage(s)}
              </option>
            ))}
          </Select>
        </Field>

        <Field>
          <Label htmlFor="notes">
            {t("customers.stageNotes")} <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id="notes"
            rows={3}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder={t("customers.stageNotesPlaceholder")}
            disabled={lockSensitiveFields}
            className={lockSensitiveFields ? lockedFieldClassName : undefined}
          />
          {fieldErrors.notes && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.notes}</p>
          )}
        </Field>
      </div>

      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? t("customers.saving") : t("customers.saveChanges")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(`/customers/${initial.id}`)}
        >
          {t("common.cancel")}
        </Button>
      </div>

      {paidModalOpen && (
        <ModalOverlay onClose={closePaidApprovalModal}>
          <ModalPanel>
            <h3 className={ui.customerDetail.subsectionTitle}>
              {t("customers.paidApprovalEditTitle")}
            </h3>
            <p className="mt-2 text-sm text-[#6B7890]">
              {t("customers.paidApprovalEditNotice")}
            </p>

            {paidModalError && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {paidModalError}
              </p>
            )}

            <div className="mt-4 space-y-4">
              <Field>
                <Label htmlFor="edit-paid-service-items">
                  {t("customers.paidServiceItems")} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="edit-paid-service-items"
                  value={paidServiceItems}
                  onChange={(e) => setPaidServiceItems(e.target.value)}
                  placeholder={t("customers.paidServiceItemsPlaceholder")}
                />
              </Field>
              <Field>
                <Label htmlFor="edit-paid-amount">
                  {t("customers.paidAmount")} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="edit-paid-amount"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                />
              </Field>
              <Field>
                <Label htmlFor="edit-paid-at">
                  {t("customers.paidAt")} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="edit-paid-at"
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </Field>
              <Field>
                <Label htmlFor="edit-paid-remarks">{t("customers.paidRemarks")}</Label>
                <Textarea
                  id="edit-paid-remarks"
                  value={paidRemarks}
                  onChange={(e) => setPaidRemarks(e.target.value)}
                  placeholder={t("customers.paidRemarksPlaceholder")}
                  rows={3}
                />
              </Field>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={closePaidApprovalModal}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                disabled={paidSubmitting}
                onClick={() => void handlePaidApprovalSubmit()}
              >
                {paidSubmitting ? t("customers.submitting") : t("customers.submitRequest")}
              </Button>
            </div>
          </ModalPanel>
        </ModalOverlay>
      )}
    </form>
  );
}
