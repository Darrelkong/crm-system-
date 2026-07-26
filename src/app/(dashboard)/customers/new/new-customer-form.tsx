"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, Select, Label, Field } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { CUSTOMER_TYPES, CREATABLE_SALES_STAGES } from "@/lib/constants/customer-fields";
import type { CustomerType, SalesStage } from "@/lib/constants/customer-fields";
import type { CustomerTagOption } from "@/lib/customer-tags/types";
import type { ValidationFieldError } from "@/lib/customers/validation";
import { validateCustomerInput } from "@/lib/customers/validation";
import {
  clearCustomerCreateDraft,
  createEmptyCustomerCreateFormData,
  formatDraftSavedClock,
  isCustomerCreateDraftMeaningful,
  loadCustomerCreateDraft,
  type CustomerCreateDraftFormData,
} from "@/lib/customers/customer-create-draft";
import { createCustomerCreateDraftAutosave } from "@/lib/customers/customer-create-draft-autosave";
import {
  createCustomerCreateSubmitFlight,
  postCustomerCreateOnce,
} from "@/lib/customers/customer-create-submit-flight";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError, resolveFieldError } from "@/i18n/resolve-api-error";
import { CreateCustomerConfirmModal } from "./create-customer-confirm-modal";
import { CustomerCreateMobileActions } from "./customer-create-mobile-actions";
import { IncompleteContactConfirmModal } from "./incomplete-contact-confirm-modal";
import { OnHoldApprovalSubmittedModal, OnHoldReasonModal } from "./on-hold-approval-pending-modal";
import { useMobileKeyboardOpen } from "./use-mobile-keyboard-open";
import { FollowUpOrganizeControls } from "@/components/follow-ups/follow-up-organize-controls";
import {
  getIncompleteContactKind,
  type IncompleteContactKind,
} from "@/lib/customers/incomplete-contact";

const NEW_CUSTOMER_FORM_ID = "new-customer-form";

type DuplicateMatch = {
  field: string;
  customer:
    | { isMasked: true }
    | { isMasked: false; id: string; customerName: string; status: string };
};

const COUNTRY_CODES = ["+86", "+852", "+853", "+886", "+1", "+44", "+81"];

type FormState = CustomerCreateDraftFormData & {
  customerType: CustomerType;
  salesStage: SalesStage | "";
};

function toFormState(data: CustomerCreateDraftFormData): FormState {
  return {
    ...data,
    customerType: (CUSTOMER_TYPES as readonly string[]).includes(data.customerType)
      ? (data.customerType as CustomerType)
      : "individual",
    salesStage: data.salesStage
      ? (data.salesStage as SalesStage | "")
      : "new_lead",
  };
}

export function NewCustomerForm({
  tags,
  userId,
}: {
  tags: CustomerTagOption[];
  userId: string;
}) {
  const router = useRouter();
  const { t, salesStage, customerType, fieldLabel } = useCustomerLabels();
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [showCreateConfirmModal, setShowCreateConfirmModal] = useState(false);
  const [incompleteContactKind, setIncompleteContactKind] =
    useState<IncompleteContactKind | null>(null);
  const [showIncompleteContactModal, setShowIncompleteContactModal] =
    useState(false);
  const [showOnHoldReasonModal, setShowOnHoldReasonModal] = useState(false);
  const [showOnHoldSubmittedModal, setShowOnHoldSubmittedModal] = useState(false);
  const [form, setForm] = useState<FormState>(() =>
    toFormState(createEmptyCustomerCreateFormData()),
  );
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftStorageUnavailable, setDraftStorageUnavailable] = useState(false);
  const [showDraftRestoreModal, setShowDraftRestoreModal] = useState(false);
  const [pendingDraft, setPendingDraft] =
    useState<CustomerCreateDraftFormData | null>(null);
  const draftAutosaveRef = useRef(
    createCustomerCreateDraftAutosave({
      onPersisted: (result) => {
        if (result.ok) {
          setDraftSavedAt(result.value ? result.value.savedAt : null);
          setDraftStorageUnavailable(false);
        } else if (result.reason === "unavailable") {
          setDraftStorageUnavailable(true);
        }
      },
    }),
  );
  /** Sync POST lock — must beat React submitting state for double-click. */
  const submitFlightRef = useRef(createCustomerCreateSubmitFlight());
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const wechatInputRef = useRef<HTMLInputElement>(null);
  const keyboardOpen = useMobileKeyboardOpen();

  useEffect(() => {
    const autosave = draftAutosaveRef.current;
    autosave.cancelPending();
    autosave.resetWriteBlock();

    const loaded = loadCustomerCreateDraft(userId);
    if (loaded.ok && isCustomerCreateDraftMeaningful(loaded.value.form)) {
      setPendingDraft(loaded.value.form);
      setShowDraftRestoreModal(true);
      autosave.setReady(false);
      return;
    }

    if (loaded.ok && !isCustomerCreateDraftMeaningful(loaded.value.form)) {
      clearCustomerCreateDraft(userId);
    }

    if (!loaded.ok && loaded.reason === "unavailable") {
      setDraftStorageUnavailable(true);
    }
    autosave.setReady(true);
  }, [userId]);

  useEffect(() => {
    const autosave = draftAutosaveRef.current;
    autosave.schedule(userId, form, submitting);
    return () => {
      autosave.cancelPending();
    };
  }, [form, userId, submitting]);

  useEffect(() => {
    const autosave = draftAutosaveRef.current;
    return () => {
      autosave.dispose();
    };
  }, []);

  function set(field: keyof FormState, value: string) {
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

  function continueDraft() {
    if (pendingDraft) {
      setForm(toFormState(pendingDraft));
      setDraftSavedAt(Date.now());
    }
    setPendingDraft(null);
    setShowDraftRestoreModal(false);
    draftAutosaveRef.current.setReady(true);
  }

  function discardDraft() {
    draftAutosaveRef.current.discard(userId);
    setForm(toFormState(createEmptyCustomerCreateFormData()));
    setDraftSavedAt(null);
    setPendingDraft(null);
    setShowDraftRestoreModal(false);
  }

  /** Accepted by the server: never write drafts again on this instance. */
  function finalizeAcceptedSubmission(): void {
    draftAutosaveRef.current.finalizeAccepted(userId);
    setDraftSavedAt(null);
  }

  function unlockSubmitFlight(): void {
    submitFlightRef.current.release();
    setSubmitting(false);
  }

  async function submitCreate(onHoldReason?: string) {
    const body = onHoldReason ? { ...form, onHoldReason } : form;
    const gated = await postCustomerCreateOnce({
      flight: submitFlightRef.current,
      body,
      onAcquired: () => {
        setSubmitting(true);
        setFieldErrors({});
        setServerError(null);
        setDuplicates(null);
      },
    });

    if (gated.status === "blocked") {
      return;
    }

    if (gated.status === "network_error") {
      setServerError(t("common.networkError"));
      if (onHoldReason) {
        setShowOnHoldReasonModal(true);
      }
      unlockSubmitFlight();
      return;
    }

    try {
      const res = gated.response;
      const data = (await res.json()) as {
        ok?: boolean;
        id?: string;
        pendingApproval?: boolean;
        approvalId?: string;
        message?: string;
        error?: string;
        errorCode?: string;
        fieldErrors?: ValidationFieldError[];
        code?: string;
        duplicates?: DuplicateMatch[];
      };

      if (res.ok && data.pendingApproval) {
        // Success: keep flight locked; do not unlock after accepted submit.
        finalizeAcceptedSubmission();
        setShowCreateConfirmModal(false);
        setShowOnHoldReasonModal(false);
        setShowOnHoldSubmittedModal(true);
        return;
      }

      if (res.ok && data.id) {
        finalizeAcceptedSubmission();
        setShowCreateConfirmModal(false);
        setShowOnHoldReasonModal(false);
        router.push(`/customers/${data.id}`);
        return;
      }

      if (res.status === 400 && data.fieldErrors) {
        const errs: Record<string, string> = {};
        for (const fe of data.fieldErrors) errs[fe.field] = resolveFieldError(t, fe);
        setFieldErrors(errs);
        if (onHoldReason) {
          setShowOnHoldReasonModal(true);
        }
        unlockSubmitFlight();
        return;
      }

      if (res.status === 409 && data.code === "duplicate_customer") {
        setDuplicates(data.duplicates ?? []);
        setServerError(t("customers.duplicateFound"));
        if (onHoldReason) {
          setShowOnHoldReasonModal(false);
        }
        unlockSubmitFlight();
        return;
      }

      setServerError(resolveApiError(t, data));
      if (onHoldReason) {
        setShowOnHoldReasonModal(true);
      }
      unlockSubmitFlight();
    } catch {
      setServerError(t("common.networkError"));
      if (onHoldReason) {
        setShowOnHoldReasonModal(true);
      }
      unlockSubmitFlight();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || submitFlightRef.current.isInFlight()) {
      return;
    }
    if (showIncompleteContactModal || showCreateConfirmModal) {
      return;
    }

    setFieldErrors({});
    setServerError(null);
    setDuplicates(null);

    const validationErrors = validateCustomerInput(form, {
      requireSalesStage: true,
      allowedSourceKeys: tags.map((tag) => tag.tagKey),
    });
    if (validationErrors.length > 0) {
      const errs: Record<string, string> = {};
      for (const fe of validationErrors) errs[fe.field] = resolveFieldError(t, fe);
      setFieldErrors(errs);
      return;
    }

    const incomplete = getIncompleteContactKind(form.phone, form.wechatId);
    if (incomplete) {
      setIncompleteContactKind(incomplete);
      setShowIncompleteContactModal(true);
      return;
    }

    setShowCreateConfirmModal(true);
  }

  function handleIncompleteContactBack() {
    const kind = incompleteContactKind;
    setShowIncompleteContactModal(false);
    setIncompleteContactKind(null);
    window.requestAnimationFrame(() => {
      if (kind === "phone") {
        phoneInputRef.current?.focus();
      } else if (kind === "wechat") {
        wechatInputRef.current?.focus();
      }
    });
  }

  function handleIncompleteContactContinue() {
    setShowIncompleteContactModal(false);
    setIncompleteContactKind(null);
    setShowCreateConfirmModal(true);
  }

  function handleConfirmCreate() {
    if (submitting || submitFlightRef.current.isInFlight()) {
      return;
    }

    // Keep create-confirm open while submitting so the button shows loading.
    // On-hold only switches modals — POST happens after reason submit.
    if (form.salesStage === "on_hold") {
      setShowCreateConfirmModal(false);
      setShowOnHoldReasonModal(true);
      return;
    }

    void submitCreate();
  }

  return (
    <>
      <CreateCustomerConfirmModal
        open={showCreateConfirmModal}
        submitting={submitting}
        data={{
          customerName: form.customerName,
          requestedProjectName: form.requestedProjectName,
          phoneCountryCode: form.phoneCountryCode,
          phone: form.phone,
          wechatId: form.wechatId,
          email: form.email,
        }}
        onBack={() => setShowCreateConfirmModal(false)}
        onConfirm={handleConfirmCreate}
      />
      <IncompleteContactConfirmModal
        open={showIncompleteContactModal}
        kind={incompleteContactKind}
        onBack={handleIncompleteContactBack}
        onContinue={handleIncompleteContactContinue}
      />
      <OnHoldReasonModal
        open={showOnHoldReasonModal}
        submitting={submitting}
        onCancel={() => setShowOnHoldReasonModal(false)}
        onSubmit={(onHoldReason) => {
          void submitCreate(onHoldReason);
        }}
      />
      <OnHoldApprovalSubmittedModal
        open={showOnHoldSubmittedModal}
        onClose={() => {
          setShowOnHoldSubmittedModal(false);
          router.push("/customers");
        }}
      />
      {showDraftRestoreModal ? (
        <ModalOverlay>
          <ModalPanel>
            <h3 className="text-base font-semibold text-[#172033]">
              {t("customers.draftRestoreTitle")}
            </h3>
            <p className="mt-2 text-sm text-[#6B7890]">
              {t("customers.draftRestoreDescription")}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button type="button" onClick={continueDraft}>
                {t("customers.draftRestoreContinue")}
              </Button>
              <Button type="button" variant="secondary" onClick={discardDraft}>
                {t("customers.draftRestoreDiscard")}
              </Button>
            </div>
          </ModalPanel>
        </ModalOverlay>
      ) : null}
      <form
        id={NEW_CUSTOMER_FORM_ID}
        onSubmit={handleSubmit}
        noValidate
        className="max-w-2xl max-md:pb-16"
      >
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

      {(draftSavedAt != null || draftStorageUnavailable) && (
        <p className="mb-3 text-xs text-[#6B7890]" aria-live="polite">
          {draftStorageUnavailable
            ? t("customers.draftStorageUnavailable")
            : t("customers.draftSavedAt", {
                time: formatDraftSavedClock(draftSavedAt!),
              })}
        </p>
      )}

      <div className="surface-card p-6">
        <h3 className="mb-4 text-base font-semibold text-[#172033]">
          {t("customers.basicSection")}
        </h3>

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
          <Label htmlFor="customerName">
            {t("customers.clientName")} <span className="text-red-500">*</span>
          </Label>
          <Input
            id="customerName"
            value={form.customerName}
            onChange={(e) => set("customerName", e.target.value)}
            placeholder={t("customers.clientName")}
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

        <h4 className="mb-3 mt-6 text-sm font-medium text-[#3A465C]">
          {t("customers.contactSection")}
        </h4>
        <p className="mb-3 text-xs text-[#6B7890]">
          {t("customers.phoneWechatGuidance")}
        </p>

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
              className="w-full"
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
              id="customer-phone"
              ref={phoneInputRef}
              className="min-w-0 w-full"
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
              id="customer-wechat"
              ref={wechatInputRef}
              value={form.wechatId}
              onChange={(e) => set("wechatId", e.target.value)}
              placeholder={t("customers.wechatOptional")}
            />
          </div>
        </div>

        <Field>
          <Label htmlFor="email">
            {t("customers.email")}{" "}
            <span className="text-xs font-normal text-[#6B7890]">
              {t("customers.emailRecommended")}
            </span>
          </Label>
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
          >
            <option value="">{t("customers.selectSource")}</option>
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
              placeholder={t("customers.sourceDetailPlaceholder")}
            />
            {fieldErrors.sourceRemark && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.sourceRemark}</p>
            )}
          </Field>
        )}

        <Field>
          <Label htmlFor="salesStage">
            {t("customers.salesStage")} <span className="text-red-500">*</span>
          </Label>
          <Select
            id="salesStage"
            value={form.salesStage}
            onChange={(e) => set("salesStage", e.target.value)}
          >
            {CREATABLE_SALES_STAGES.map((s) => (
              <option key={s} value={s}>
                {salesStage(s)}
              </option>
            ))}
          </Select>
          {fieldErrors.salesStage && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.salesStage}</p>
          )}
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
          <p className="mt-1 text-xs text-[#6B7890]">
            {t("customers.stageNotesHelper")}
          </p>
          <FollowUpOrganizeControls
            customerId={null}
            value={form.notes}
            onApply={(organizedText) => set("notes", organizedText)}
          />
          {fieldErrors.notes && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.notes}</p>
          )}
        </Field>
      </div>

      <div className="mt-6 hidden gap-3 md:flex">
        <Button type="submit" disabled={submitting}>
          {submitting ? t("customers.saving") : t("customers.saveClient")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push("/customers")}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </form>
      <CustomerCreateMobileActions
        formId={NEW_CUSTOMER_FORM_ID}
        submitting={submitting}
        hidden={keyboardOpen}
        onCancel={() => router.push("/customers")}
      />
    </>
  );
}
