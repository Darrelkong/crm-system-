"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, Select, Label, Field } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { FOLLOW_UP_CHANNELS } from "@/lib/constants/follow-up-channels";
import { FOLLOW_UP_OUTCOMES } from "@/lib/constants/follow-up-outcomes";
import type { FollowUpChannel } from "@/lib/constants/follow-up-channels";
import type { FollowUpOutcome } from "@/lib/constants/follow-up-outcomes";
import {
  validateFollowUpInput,
  type ValidationFieldError,
} from "@/lib/follow-ups/validation";
import { getBeijingDatetimeLocalValue } from "@/lib/datetime/beijing";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError, resolveFieldError } from "@/i18n/resolve-api-error";

export function NewFollowUpForm({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const router = useRouter();
  const { t, followUpChannel, followUpOutcome } = useCustomerLabels();
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const [form, setForm] = useState({
    channel: "" as FollowUpChannel | "",
    outcome: "" as FollowUpOutcome | "",
    summary: "",
    customerIntent: "",
    nextFollowUpAt: getBeijingDatetimeLocalValue(),
    nextAction: "",
  });

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setServerError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setServerError(null);

    const validationErrors = validateFollowUpInput({
      channel: form.channel,
      outcome: form.outcome,
      summary: form.summary,
      customerIntent: form.customerIntent || null,
      nextFollowUpAt: form.nextFollowUpAt
        ? new Date(form.nextFollowUpAt).toISOString()
        : null,
      nextAction: form.nextAction || null,
    });

    if (validationErrors.length > 0) {
      const errs: Record<string, string> = {};
      for (const fe of validationErrors) {
        errs[fe.field] = resolveFieldError(t, fe);
      }
      setFieldErrors(errs);
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch(`/api/customers/${customerId}/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: form.channel,
          outcome: form.outcome,
          summary: form.summary,
          customerIntent: form.customerIntent || null,
          nextFollowUpAt: new Date(form.nextFollowUpAt).toISOString(),
          nextAction: form.nextAction,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        errorCode?: string;
        fieldErrors?: ValidationFieldError[];
      };

      if (res.ok) {
        router.push(`/customers/${customerId}`);
        return;
      }

      if (res.status === 400 && data.fieldErrors) {
        const errs: Record<string, string> = {};
        for (const fe of data.fieldErrors) {
          errs[fe.field] = resolveFieldError(t, fe);
        }
        setFieldErrors(errs);
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
      <p className="mb-4 text-sm text-[#6B7890]">
        {t("followUps.addFollowUpFor", { name: customerName })}
      </p>

      {serverError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {serverError}
        </div>
      )}

      <div className="surface-card p-6">
        <Field>
          <Label htmlFor="channel">
            {t("followUps.channel")} <span className="text-red-500">*</span>
          </Label>
          <Select
            id="channel"
            value={form.channel}
            onChange={(e) => set("channel", e.target.value)}
          >
            <option value="">{t("followUps.selectChannel")}</option>
            {FOLLOW_UP_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {followUpChannel(c)}
              </option>
            ))}
          </Select>
          {fieldErrors.channel && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.channel}</p>
          )}
        </Field>

        <Field>
          <Label htmlFor="outcome">
            {t("followUps.outcome")} <span className="text-red-500">*</span>
          </Label>
          <Select
            id="outcome"
            value={form.outcome}
            onChange={(e) => set("outcome", e.target.value)}
          >
            <option value="">{t("followUps.selectOutcome")}</option>
            {FOLLOW_UP_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {followUpOutcome(o)}
              </option>
            ))}
          </Select>
          {fieldErrors.outcome && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.outcome}</p>
          )}
        </Field>

        <Field>
          <Label htmlFor="summary">
            {t("followUps.notes")} <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id="summary"
            rows={4}
            value={form.summary}
            onChange={(e) => set("summary", e.target.value)}
            placeholder={t("followUps.notesPlaceholder")}
          />
          {fieldErrors.summary && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.summary}</p>
          )}
        </Field>

        <Field>
          <Label htmlFor="customerIntent">{t("followUps.customerIntent")}</Label>
          <Input
            id="customerIntent"
            value={form.customerIntent}
            onChange={(e) => set("customerIntent", e.target.value)}
            placeholder={t("followUps.optional")}
          />
        </Field>

        <Field>
          <Label htmlFor="nextFollowUpAt">
            {t("followUps.nextFollowUpDate")}{" "}
            <span className="text-red-500">*</span>
          </Label>
          <Input
            id="nextFollowUpAt"
            type="datetime-local"
            value={form.nextFollowUpAt}
            onChange={(e) => set("nextFollowUpAt", e.target.value)}
          />
          {fieldErrors.nextFollowUpAt && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.nextFollowUpAt}</p>
          )}
          <p className="mt-1 text-xs text-[#6B7890]">{t("followUps.autoCreateTask")}</p>
        </Field>

        <Field>
          <Label htmlFor="nextAction">
            {t("followUps.nextAction")} <span className="text-red-500">*</span>
          </Label>
          <Input
            id="nextAction"
            value={form.nextAction}
            onChange={(e) => set("nextAction", e.target.value)}
            placeholder={t("followUps.nextActionPlaceholder")}
          />
          {fieldErrors.nextAction && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.nextAction}</p>
          )}
        </Field>
      </div>

      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? t("customers.saving") : t("followUps.saveFollowUp")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(`/customers/${customerId}`)}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
