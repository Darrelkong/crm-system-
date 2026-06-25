"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, Select, Label, Field } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { CUSTOMER_SOURCE_KEYS } from "@/lib/constants/customer-sources";
import { CUSTOMER_TYPES, SALES_STAGES } from "@/lib/constants/customer-fields";
import type { CustomerSourceKey } from "@/lib/constants/customer-sources";
import type { CustomerType, SalesStage } from "@/lib/constants/customer-fields";
import type { ValidationFieldError } from "@/lib/customers/validation";
import { validateCustomerInput } from "@/lib/customers/validation";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError, resolveFieldError } from "@/i18n/resolve-api-error";

type DuplicateMatch = {
  field: string;
  customer: { id: string; customerName: string; status: string; isMasked: boolean };
};

const COUNTRY_CODES = ["+86", "+852", "+853", "+886", "+1", "+44", "+81"];

const EDITABLE_STATUS_KEYS = ["active", "inactive", "archived"] as const;

export type EditCustomerInitial = {
  id: string;
  customerName: string;
  customerType: CustomerType;
  phoneCountryCode: string;
  phone: string;
  wechatId: string;
  email: string;
  source: CustomerSourceKey;
  sourceRemark: string;
  requestedProjectName: string;
  notes: string;
  salesStage: SalesStage;
  status: string;
};

export function EditCustomerForm({
  initial,
  canEditStatus = false,
}: {
  initial: EditCustomerInitial;
  canEditStatus?: boolean;
}) {
  const router = useRouter();
  const { t, source, salesStage, customerType, status, fieldLabel } = useCustomerLabels();
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);

  const isPublicPool = initial.status === "public_pool";
  const showStatusDropdown = canEditStatus && !isPublicPool;

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setServerError(null);
    setDuplicates(null);

    const validationErrors = validateCustomerInput(form, {
      isUpdate: true,
      existingNotes: initial.notes,
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
                    <span className="ml-1 font-medium">
                      {d.customer.customerName} {t("customers.maskedNoDetail")}
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

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-base font-semibold text-slate-900">
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
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            >
              {status(form.status)}
            </p>
          )}
          {showStatusDropdown && (
            <p className="mt-1 text-xs text-slate-500">
              {t("customers.useReleaseFlowForPublicPool")}
            </p>
          )}
          {canEditStatus && isPublicPool && (
            <p className="mt-1 text-xs text-slate-500">
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
            <span className="ml-1 text-xs font-normal text-slate-500">
              {t("customers.atLeastOne")}
            </span>
          </Label>
          <div className="flex gap-2">
            <Select
              className="w-28 shrink-0"
              value={form.phoneCountryCode}
              onChange={(e) => set("phoneCountryCode", e.target.value)}
            >
              {COUNTRY_CODES.map((cc) => (
                <option key={cc} value={cc}>
                  {cc}
                </option>
              ))}
            </Select>
            <Input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder={t("customers.phonePlaceholder")}
              type="tel"
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
          />
          {fieldErrors.email && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>
          )}
        </Field>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-base font-semibold text-slate-900">
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
          >
            {CUSTOMER_SOURCE_KEYS.map((k) => (
              <option key={k} value={k}>
                {source(k)}
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
            {SALES_STAGES.map((s) => (
              <option key={s} value={s}>
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
        <a
          href={`/customers/${initial.id}`}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t("common.cancel")}
        </a>
      </div>
    </form>
  );
}
