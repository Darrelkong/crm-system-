"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, Select, Label, Field } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { CUSTOMER_SOURCE_KEYS } from "@/lib/constants/customer-sources";
import { CUSTOMER_SOURCE_LABELS } from "@/lib/constants/customer-source-labels";
import { CUSTOMER_TYPES, CUSTOMER_TYPE_LABELS, SALES_STAGES, SALES_STAGE_LABELS } from "@/lib/constants/customer-fields";
import type { CustomerSourceKey } from "@/lib/constants/customer-sources";
import type { CustomerType, SalesStage } from "@/lib/constants/customer-fields";
import type { ValidationFieldError } from "@/lib/customers/validation";

type DuplicateMatch = {
  field: string;
  customer: { id: string; customerName: string; status: string; isMasked: boolean };
};

const COUNTRY_CODES = ["+86", "+852", "+853", "+886", "+1", "+44", "+81"];

export function NewCustomerForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);

  const [form, setForm] = useState({
    customerName: "",
    customerType: "individual" as CustomerType,
    phoneCountryCode: "+86",
    phone: "",
    wechatId: "",
    email: "",
    source: "" as CustomerSourceKey | "",
    sourceRemark: "",
    notes: "",
    salesStage: "new_lead" as SalesStage,
  });

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      // Clear related field errors
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

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        id?: string;
        error?: string;
        fieldErrors?: ValidationFieldError[];
        code?: string;
        duplicates?: DuplicateMatch[];
      };

      if (res.ok && data.id) {
        router.push(`/customers/${data.id}`);
        return;
      }

      if (res.status === 400 && data.fieldErrors) {
        const errs: Record<string, string> = {};
        for (const fe of data.fieldErrors) errs[fe.field] = fe.message;
        setFieldErrors(errs);
        return;
      }

      if (res.status === 409 && data.code === "duplicate_customer") {
        setDuplicates(data.duplicates ?? []);
        setServerError("发现重复客户，请检查以下信息");
        return;
      }

      setServerError(data.error ?? "保存失败，请稍后重试");
    } catch {
      setServerError("网络错误，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  const FIELD_LABEL: Record<string, string> = {
    phone: "手机号",
    wechatId: "微信号",
    email: "Email",
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-2xl">
      {serverError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-700">{serverError}</p>
          {duplicates && duplicates.length > 0 && (
            <ul className="mt-2 space-y-1">
              {duplicates.map((d, i) => (
                <li key={i} className="text-sm text-red-600">
                  {FIELD_LABEL[d.field] ?? d.field} 已存在：
                  {d.customer.isMasked ? (
                    <span className="ml-1 font-medium">
                      {d.customer.customerName}（脱敏客户，无法查看详情）
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
        <h3 className="mb-4 text-base font-semibold text-slate-900">基本信息</h3>

        <Field>
          <Label htmlFor="customerName">
            客户名称 <span className="text-red-500">*</span>
          </Label>
          <Input
            id="customerName"
            value={form.customerName}
            onChange={(e) => set("customerName", e.target.value)}
            placeholder="请输入客户名称"
          />
          {fieldErrors.customerName && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.customerName}</p>
          )}
        </Field>

        <Field>
          <Label htmlFor="customerType">客户类型</Label>
          <Select
            id="customerType"
            value={form.customerType}
            onChange={(e) => set("customerType", e.target.value)}
          >
            {CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {CUSTOMER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>

        <div className="mb-4">
          <Label>
            手机号 / 微信号 <span className="text-red-500">*</span>
            <span className="ml-1 text-xs font-normal text-slate-500">（至少填写一项）</span>
          </Label>
          <div className="flex gap-2">
            <Select
              className="w-28 shrink-0"
              value={form.phoneCountryCode}
              onChange={(e) => set("phoneCountryCode", e.target.value)}
            >
              {COUNTRY_CODES.map((cc) => (
                <option key={cc} value={cc}>{cc}</option>
              ))}
            </Select>
            <Input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="手机号"
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
              placeholder="微信号（可选）"
            />
          </div>
        </div>

        <Field>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="邮箱（可选）"
          />
          {fieldErrors.email && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>
          )}
        </Field>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-base font-semibold text-slate-900">来源 & 阶段</h3>

        <Field>
          <Label htmlFor="source">
            客户来源 <span className="text-red-500">*</span>
          </Label>
          <Select
            id="source"
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
          >
            <option value="">请选择来源</option>
            {CUSTOMER_SOURCE_KEYS.map((k) => (
              <option key={k} value={k}>
                {CUSTOMER_SOURCE_LABELS[k as CustomerSourceKey]}
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
              来源备注 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="sourceRemark"
              value={form.sourceRemark}
              onChange={(e) => set("sourceRemark", e.target.value)}
              placeholder="请描述来源详情"
            />
            {fieldErrors.sourceRemark && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.sourceRemark}</p>
            )}
          </Field>
        )}

        <Field>
          <Label htmlFor="salesStage">销售阶段</Label>
          <Select
            id="salesStage"
            value={form.salesStage}
            onChange={(e) => set("salesStage", e.target.value)}
          >
            {SALES_STAGES.map((s) => (
              <option key={s} value={s}>
                {SALES_STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field>
          <Label htmlFor="notes">备注</Label>
          <Textarea
            id="notes"
            rows={3}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="其他备注信息（可选）"
          />
        </Field>
      </div>

      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "保存中…" : "保存客户"}
        </Button>
        <a
          href="/customers"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          取消
        </a>
      </div>
    </form>
  );
}
