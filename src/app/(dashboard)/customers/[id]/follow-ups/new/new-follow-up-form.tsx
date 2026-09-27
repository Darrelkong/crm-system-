"use client";

import { isCustomerRatingValue, type CustomerRatingValue } from "@/lib/customers/rating/domain";
import { changeFollowUpField, refreshRatingReference, requiresRatingSelection } from "@/lib/customers/rating/form-state";
import { FollowUpRatingFields } from "@/components/follow-ups/follow-up-rating-fields";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, Select, Label, Field } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { FOLLOW_UP_CHANNELS } from "@/lib/constants/follow-up-channels";
import { FOLLOW_UP_OUTCOMES } from "@/lib/constants/follow-up-outcomes";
import type { FollowUpChannel } from "@/lib/constants/follow-up-channels";
import type { FollowUpOutcome } from "@/lib/constants/follow-up-outcomes";
import {
  getMinNextFollowUpDatetimeLocal,
  validateFollowUpInput,
  type ValidationFieldError,
} from "@/lib/follow-ups/validation";
import {
  createFollowUpSubmitFlight,
  postFollowUpCreateOnce,
} from "@/lib/follow-ups/follow-up-create-submit-flight";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError, resolveFieldError } from "@/i18n/resolve-api-error";
import { FollowUpOrganizeControls } from "@/components/follow-ups/follow-up-organize-controls";
import { getCustomerDisplayName } from "@/lib/customers/customer-display-name";

export function NewFollowUpForm({
  customerId,
  customerName,
  nameStatus,
  firstContactGateActive = false,
  customerRating,
  customerRatingRevision,
}: {
  customerId: string;
  customerName: string;
  nameStatus?: string;
  firstContactGateActive?: boolean;
  customerRating: CustomerRatingValue;
  customerRatingRevision: number;
}) {
  const router = useRouter();
  const { t, followUpChannel, followUpOutcome } = useCustomerLabels();
  const { locale } = useTranslation();
  const displayName = getCustomerDisplayName({
    customerName,
    nameStatus,
    locale,
  });
  const submitFlightRef = useRef(createFollowUpSubmitFlight());
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false);

  const [ratingReference, setRatingReference] = useState({ customerRating, customerRatingRevision });
  const minNextFollowUpAt = getMinNextFollowUpDatetimeLocal();

  const [form, setForm] = useState({
    channel: "" as FollowUpChannel | "",
    outcome: "" as FollowUpOutcome | "",
    summary: "",
    customerRating: "",
    nextFollowUpAt: "",
    nextAction: "",
  });

  function set(field: string, value: string) {
    setForm((prev) => changeFollowUpField(prev, field, value));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setServerError(null);
  }

  function unlockSubmitFlight(): void {
    submitFlightRef.current.release();
    setSubmitting(submitFlightRef.current.isLocked());
  }

  async function submitFollowUp(confirmDuplicateFollowUp = false) {
    setFieldErrors({});
    setServerError(null);

    const validationErrors = validateFollowUpInput({
      channel: form.channel,
      outcome: form.outcome,
      summary: form.summary,
      customerRating: form.customerRating,
      expectedCustomerRatingRevision: ratingReference.customerRatingRevision,
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
      return;
    }

    const nextFollowUpAtIso = new Date(form.nextFollowUpAt).toISOString();
    const body = {
      channel: form.channel,
      outcome: form.outcome,
      summary: form.summary,
      ...(requiresRatingSelection(form.outcome) ? { customerRating: form.customerRating,
        expectedCustomerRatingRevision: ratingReference.customerRatingRevision } : {}),
      nextFollowUpAt: nextFollowUpAtIso,
      nextAction: form.nextAction,
      ...(confirmDuplicateFollowUp ? { confirmDuplicateFollowUp: true } : {}),
    };

    const gated = await postFollowUpCreateOnce({
      flight: submitFlightRef.current,
      customerId,
      body,
      onAcquired: () => {
        setSubmitting(true);
      },
    });

    if (gated.status === "blocked") {
      return;
    }

    if (gated.status === "network_error") {
      setServerError(t("common.networkError"));
      unlockSubmitFlight();
      return;
    }

    try {
      const res = gated.response;
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        errorCode?: string;
        requiresConfirm?: boolean;
        customerRating?: unknown;
        customerRatingRevision?: number;
        fieldErrors?: ValidationFieldError[];
      };

      if (res.ok) {
        submitFlightRef.current.complete();
        setDuplicateConfirmOpen(false);
        router.push(`/customers/${customerId}`);
        return;
      }

      if (res.status === 409 && data.errorCode === "CUSTOMER_RATING_STALE") {
        if (isCustomerRatingValue(data.customerRating) && typeof data.customerRatingRevision === "number"
          && Number.isSafeInteger(data.customerRatingRevision) && data.customerRatingRevision >= 0) {
          const refreshed = refreshRatingReference(form, data.customerRating, data.customerRatingRevision);
          setForm(refreshed.form);
          setRatingReference(refreshed.reference);
        } else {
          setForm((previous) => ({ ...previous, customerRating: "" }));
        }
        setDuplicateConfirmOpen(false);
        setServerError(t("followUps.ratingStale"));
        unlockSubmitFlight();
        return;
      }

      if (res.status === 409 && data.errorCode === "FOLLOW_UP_DUPLICATE_CONTENT") {
        setDuplicateConfirmOpen(true);
        unlockSubmitFlight();
        return;
      }

      if (res.status === 403 && data.errorCode === "FIRST_CONTACT_REQUIRED") {
        setServerError(t("followUps.firstContactGateMessage"));
        unlockSubmitFlight();
        return;
      }

      if (res.status === 400 && data.fieldErrors) {
        const errs: Record<string, string> = {};
        for (const fe of data.fieldErrors) {
          errs[fe.field] = resolveFieldError(t, fe);
        }
        setFieldErrors(errs);
        unlockSubmitFlight();
        return;
      }

      setServerError(resolveApiError(t, data));
      unlockSubmitFlight();
    } catch {
      setServerError(t("common.networkError"));
      unlockSubmitFlight();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDuplicateConfirmOpen(false);
    await submitFollowUp(false);
  }

  async function handleConfirmDuplicate() {
    await submitFollowUp(true);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-2xl">
      <fieldset disabled={submitting} className="min-w-0">
      <p className="mb-4 text-sm text-[#6B7890]">
        {t("followUps.addFollowUpFor", { name: displayName })}
      </p>

      {firstContactGateActive && (
        <div
          className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
          data-testid="first-contact-gate-warning"
        >
          <p className="font-medium">{t("followUps.firstContactGateTitle")}</p>
          <p className="mt-1">{t("followUps.firstContactGateMessage")}</p>
          <Link
            href="/work-items?tab=tasks&view=open"
            className="mt-3 inline-flex text-sm font-medium text-[#1B3A6B] underline underline-offset-2 dark:text-[#93B4E8]"
          >
            {t("followUps.firstContactGateCta")}
          </Link>
        </div>
      )}

      {duplicateConfirmOpen && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>
            本次跟进内容与最近一次记录相同，请确认是否继续提交。
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={submitting}
              onClick={() => void handleConfirmDuplicate()}
            >
              {t("common.confirm")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={submitting}
              onClick={() => setDuplicateConfirmOpen(false)}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

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
          <FollowUpOrganizeControls
            customerId={customerId}
            value={form.summary}
            onApply={(organizedText) => set("summary", organizedText)}
          />
          {fieldErrors.summary && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.summary}</p>
          )}
        </Field>

        <FollowUpRatingFields currentRating={ratingReference.customerRating} outcome={form.outcome}
          selectedRating={form.customerRating} onChange={(rating) => set("customerRating", rating)}
          error={fieldErrors.customerRating} t={t} />

        <Field>
          <Label htmlFor="nextFollowUpAt">
            {t("followUps.nextFollowUpDate")}{" "}
            <span className="text-red-500">*</span>
          </Label>
          <Input
            id="nextFollowUpAt"
            type="datetime-local"
            value={form.nextFollowUpAt}
            min={minNextFollowUpAt}
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
          <Textarea
            id="nextAction"
            rows={4}
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
        <Button type="submit" disabled={submitting || firstContactGateActive}>
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
      </fieldset>
    </form>
  );
}
