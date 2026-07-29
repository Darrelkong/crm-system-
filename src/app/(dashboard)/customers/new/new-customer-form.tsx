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
import {
  CustomerCreateDuplicateAlert,
  isCustomerCreateDuplicateConflict,
  isCustomerCreateNameDuplicateWarning,
  resolveDuplicateFocusField,
} from "./customer-create-duplicate-alert";
import { CustomerCreateMobileActions } from "./customer-create-mobile-actions";
import { IncompleteContactConfirmModal } from "./incomplete-contact-confirm-modal";
import { OnHoldApprovalSubmittedModal, OnHoldReasonModal } from "./on-hold-approval-pending-modal";
import { useMobileKeyboardOpen } from "./use-mobile-keyboard-open";
import { FollowUpOrganizeControls } from "@/components/follow-ups/follow-up-organize-controls";
import {
  getIncompleteContactKind,
  type IncompleteContactKind,
} from "@/lib/customers/incomplete-contact";
import { PENDING_NAME_PLACEHOLDERS } from "@/lib/customers/name-status";
import { getCustomerDisplayName } from "@/lib/customers/customer-display-name";
import { useTranslation } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { RequestedProjectSelector } from "@/components/customers/requested-project-selector";
import {
  getRequestedProjectItem,
  isRequestedProjectOtherCode,
  REQUESTED_PROJECT_OTHER_CODE,
} from "@/lib/constants/requested-projects";
import { resolveRequestedProjectDisplayName } from "@/lib/customers/requested-project-display";
import {
  CustomerProfileSection,
  shouldExpandCustomerProfileSection,
} from "@/components/customers/customer-profile-section";
import { type CustomerProfileFormFields } from "@/lib/customers/customer-profile";

const NEW_CUSTOMER_FORM_ID = "new-customer-form";

type DuplicateMatch = {
  field: string;
  matchedField?: string;
  customer:
    | { isMasked: true }
    | {
        isMasked: false;
        id: string;
        customerCode?: string | null;
        displayName: string;
        salesStage: string;
        href: string;
      };
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
  const { t, salesStage, customerType } = useCustomerLabels();
  const { locale } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [nameDuplicateWarning, setNameDuplicateWarning] = useState<{
    normalizedName: string;
    duplicates: DuplicateMatch[];
  } | null>(null);
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
  const [profileInitiallyExpanded, setProfileInitiallyExpanded] =
    useState(false);
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
  const emailInputRef = useRef<HTMLInputElement>(null);
  const customerNameInputRef = useRef<HTMLInputElement>(null);
  const duplicateAlertRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (duplicates === null && nameDuplicateWarning === null) return;
    const el = duplicateAlertRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus({ preventScroll: true });
  }, [duplicates, nameDuplicateWarning]);

  function focusDuplicateContactField() {
    const focusField = resolveDuplicateFocusField(duplicates);
    if (focusField === "phone") {
      phoneInputRef.current?.focus();
      return;
    }
    if (focusField === "wechatId") {
      wechatInputRef.current?.focus();
      return;
    }
    if (focusField === "email") {
      emailInputRef.current?.focus();
      return;
    }
    document.getElementById("customerName")?.focus();
  }

  function focusCustomerNameField() {
    setNameDuplicateWarning(null);
    if (form.nameStatus === "pending") {
      document.getElementById("customerName")?.focus();
      return;
    }
    customerNameInputRef.current?.focus();
    document.getElementById("customerName")?.focus();
  }

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
    if (field === "customerName" || field === "nameStatus") {
      setNameDuplicateWarning(null);
    }
  }

  function continueDraft() {
    if (pendingDraft) {
      setForm(toFormState(pendingDraft));
      setDraftSavedAt(Date.now());
      if (shouldExpandCustomerProfileSection(pendingDraft)) {
        setProfileInitiallyExpanded(true);
      }
    }
    setPendingDraft(null);
    setShowDraftRestoreModal(false);
    draftAutosaveRef.current.setReady(true);
  }

  function setProfileField(
    field: keyof CustomerProfileFormFields,
    value: string,
  ) {
    set(field, value);
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

  async function submitCreate(
    onHoldReason?: string,
    options?: { confirmDuplicateName?: string },
  ) {
    const body = {
      ...(onHoldReason ? { ...form, onHoldReason } : { ...form }),
      ...(options?.confirmDuplicateName
        ? { confirmDuplicateName: options.confirmDuplicateName }
        : {}),
    };
    const gated = await postCustomerCreateOnce({
      flight: submitFlightRef.current,
      body,
      onAcquired: () => {
        setSubmitting(true);
        setFieldErrors({});
        setServerError(null);
        setDuplicates(null);
        if (!options?.confirmDuplicateName) {
          setNameDuplicateWarning(null);
        }
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
        normalizedName?: string;
      };

      if (res.ok && data.pendingApproval) {
        // Success: keep flight locked; do not unlock after accepted submit.
        finalizeAcceptedSubmission();
        setShowCreateConfirmModal(false);
        setShowOnHoldReasonModal(false);
        setNameDuplicateWarning(null);
        setShowOnHoldSubmittedModal(true);
        return;
      }

      if (res.ok && data.id) {
        finalizeAcceptedSubmission();
        setShowCreateConfirmModal(false);
        setShowOnHoldReasonModal(false);
        setNameDuplicateWarning(null);
        router.replace(`/customers/${data.id}/created`);
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

      if (isCustomerCreateDuplicateConflict(res.status, data)) {
        setNameDuplicateWarning(null);
        setDuplicates(data.duplicates ?? []);
        setServerError(null);
        setShowCreateConfirmModal(false);
        setShowOnHoldReasonModal(false);
        unlockSubmitFlight();
        return;
      }

      if (isCustomerCreateNameDuplicateWarning(res.status, data)) {
        setDuplicates(null);
        setNameDuplicateWarning({
          normalizedName: data.normalizedName ?? "",
          duplicates: data.duplicates ?? [],
        });
        setServerError(null);
        setShowCreateConfirmModal(false);
        setShowOnHoldReasonModal(false);
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

  function handleConfirmNameContinue() {
    if (
      !nameDuplicateWarning?.normalizedName ||
      submitting ||
      submitFlightRef.current.isInFlight()
    ) {
      return;
    }
    void submitCreate(undefined, {
      confirmDuplicateName: nameDuplicateWarning.normalizedName,
    });
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
    setNameDuplicateWarning(null);

    const validationErrors = validateCustomerInput(
      {
        ...form,
        requestedProjectCode: form.requestedProjectCode || null,
      },
      {
        requireSalesStage: true,
        allowedSourceKeys: tags.map((tag) => tag.tagKey),
        enforceCreateNameStatusRules: true,
      },
    );
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
          customerName: getCustomerDisplayName({
            customerName: form.customerName,
            nameStatus: form.nameStatus,
            locale,
          }),
          requestedProjectName: resolveRequestedProjectDisplayName({
            requestedProjectCode: form.requestedProjectCode || null,
            requestedProjectName: form.requestedProjectName,
            locale,
          }),
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
      {duplicates !== null || nameDuplicateWarning !== null ? (
        <CustomerCreateDuplicateAlert
          alertRef={duplicateAlertRef}
          mode={
            nameDuplicateWarning
              ? "name-soft-warning"
              : "contact-hard-duplicate"
          }
          duplicates={
            nameDuplicateWarning
              ? nameDuplicateWarning.duplicates
              : duplicates
          }
          onEditContact={focusDuplicateContactField}
          onEditName={focusCustomerNameField}
          onConfirmContinue={handleConfirmNameContinue}
          confirmingContinue={
            Boolean(nameDuplicateWarning) && submitting
          }
        />
      ) : null}
      {serverError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-700">{serverError}</p>
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
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            {form.nameStatus === "pending" ? (
              <span className="text-sm font-medium crm-text">
                {t("customers.clientName")}{" "}
                <span className="text-red-500">*</span>
              </span>
            ) : (
              <Label htmlFor="customerName" className="mb-0">
                {t("customers.clientName")}{" "}
                <span className="text-red-500">*</span>
              </Label>
            )}
            <label className="inline-flex max-w-full items-center gap-2 text-sm crm-text-secondary">
              <input
                type="checkbox"
                className="size-4 shrink-0 rounded border-[var(--color-crm-border)] text-[var(--color-crm-primary)] accent-[var(--color-crm-primary)]"
                checked={form.nameStatus === "pending"}
                onChange={(e) => {
                  if (e.target.checked) {
                    setForm((prev) => ({
                      ...prev,
                      nameStatus: "pending",
                      customerName: "",
                    }));
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.customerName;
                      delete next.nameStatus;
                      return next;
                    });
                  } else {
                    setForm((prev) => ({
                      ...prev,
                      nameStatus: "confirmed",
                      customerName: "",
                    }));
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.customerName;
                      delete next.nameStatus;
                      return next;
                    });
                  }
                }}
              />
              <span className="leading-snug">{t("customers.nameUnknownToggle")}</span>
            </label>
          </div>
          {form.nameStatus === "pending" ? (
            <div
              role="radiogroup"
              aria-label={t("customers.clientName")}
              aria-invalid={
                Boolean(fieldErrors.customerName || fieldErrors.nameStatus) ||
                undefined
              }
              className={cn(
                "grid grid-cols-2 gap-2",
                (fieldErrors.customerName || fieldErrors.nameStatus) &&
                  "rounded-[var(--radius-crm)] ring-1 ring-red-500/70",
              )}
            >
              {PENDING_NAME_PLACEHOLDERS.map((placeholder) => {
                const label =
                  locale === "en"
                    ? placeholder === "X先生"
                      ? t("customers.pendingNameMrEnLabel")
                      : t("customers.pendingNameMsEnLabel")
                    : placeholder === "X先生"
                      ? t("customers.pendingNameMr")
                      : t("customers.pendingNameMs");
                const selected = form.customerName === placeholder;
                const optionId = `pending-name-${placeholder}`;
                return (
                  <label
                    key={placeholder}
                    htmlFor={optionId}
                    className={cn(
                      "surface-input flex min-h-11 cursor-pointer items-center justify-center px-3 py-2.5 text-center text-sm transition-[border-color,background-color,box-shadow,font-weight]",
                      selected
                        ? "border-[var(--color-crm-primary)] bg-[var(--color-crm-primary-soft)] font-medium text-[var(--color-crm-primary-deep)] shadow-none"
                        : "font-normal",
                    )}
                  >
                    <input
                      id={optionId}
                      type="radio"
                      name="pendingNamePlaceholder"
                      className="sr-only"
                      value={placeholder}
                      checked={selected}
                      onChange={() => set("customerName", placeholder)}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          ) : (
            <Input
              id="customerName"
              ref={customerNameInputRef}
              value={form.customerName}
              onChange={(e) => set("customerName", e.target.value)}
              placeholder={t("customers.clientName")}
            />
          )}
          {fieldErrors.customerName && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.customerName}</p>
          )}
          {fieldErrors.nameStatus && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.nameStatus}</p>
          )}
        </Field>

        <Field>
          <Label htmlFor="requestedProjectName">
            {t("customers.requestedProjectName")}{" "}
            <span className="text-red-500">*</span>
          </Label>
          <RequestedProjectSelector
            id="requestedProjectName"
            locale={locale}
            valueCode={form.requestedProjectCode || null}
            valueName={form.requestedProjectName}
            placeholder={t("customers.requestedProjectNamePlaceholder")}
            selectServiceTitle={t("customers.requestedProjectSelectService")}
            selectCountryTitle={t("customers.requestedProjectSelectCountry")}
            searchPlaceholder={t("customers.requestedProjectSearchPlaceholder")}
            backLabel={t("common.back")}
            closeLabel={t("common.close")}
            onSelect={({ code }) => {
              if (isRequestedProjectOtherCode(code)) {
                setForm((prev) => ({
                  ...prev,
                  requestedProjectCode: REQUESTED_PROJECT_OTHER_CODE,
                  requestedProjectName: prev.requestedProjectCode === REQUESTED_PROJECT_OTHER_CODE
                    ? prev.requestedProjectName
                    : "",
                }));
              } else {
                const item = getRequestedProjectItem(code);
                setForm((prev) => ({
                  ...prev,
                  requestedProjectCode: code,
                  requestedProjectName: item?.canonicalZhHans ?? "",
                }));
              }
              setFieldErrors((prev) => {
                const next = { ...prev };
                delete next.requestedProjectCode;
                delete next.requestedProjectName;
                return next;
              });
            }}
          />
          {fieldErrors.requestedProjectCode && (
            <p className="mt-1 text-xs text-red-600">
              {fieldErrors.requestedProjectCode}
            </p>
          )}
          {fieldErrors.requestedProjectName &&
            !isRequestedProjectOtherCode(form.requestedProjectCode) && (
            <p className="mt-1 text-xs text-red-600">
              {fieldErrors.requestedProjectName}
            </p>
          )}
        </Field>

        {isRequestedProjectOtherCode(form.requestedProjectCode) ? (
          <Field>
            <Label htmlFor="requestedProjectOtherName">
              {t("customers.requestedProjectOtherName")}{" "}
              <span className="text-red-500">*</span>
            </Label>
            <Input
              id="requestedProjectOtherName"
              value={form.requestedProjectName}
              onChange={(e) => set("requestedProjectName", e.target.value)}
              placeholder={t("customers.requestedProjectOtherNamePlaceholder")}
            />
            {fieldErrors.requestedProjectName && (
              <p className="mt-1 text-xs text-red-600">
                {fieldErrors.requestedProjectName}
              </p>
            )}
          </Field>
        ) : null}

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
            ref={emailInputRef}
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

      <CustomerProfileSection
        values={{
          preferredName: form.preferredName,
          gender: form.gender,
          ageRange: form.ageRange,
          preferredLanguage: form.preferredLanguage,
          preferredContactMethod: form.preferredContactMethod,
          occupation: form.occupation,
          companyName: form.companyName,
          jobTitle: form.jobTitle,
          targetCountryOrRegion: form.targetCountryOrRegion,
          primaryConcern: form.primaryConcern,
        }}
        fieldErrors={fieldErrors}
        onChange={setProfileField}
        t={t}
        idPrefix="create-profile"
        initiallyExpanded={profileInitiallyExpanded}
      />

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
