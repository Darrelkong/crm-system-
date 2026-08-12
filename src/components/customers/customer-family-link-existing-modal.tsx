"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Select } from "@/components/ui/form";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { formatHongKongDateTime } from "@/lib/timezone";
import { HOUSEHOLD_RELATIONSHIP_TYPES } from "../../../drizzle/schema/household-relationship-types";

type VisibleCandidate = {
  isMasked: false;
  customerId: string;
  customerName: string;
  createdAt: string;
  linkMode: "direct" | "approval";
};

type ProtectedCandidate = {
  isMasked: true;
  requiresApproval: true;
};

type Candidate = VisibleCandidate | ProtectedCandidate;

type ProtectedLookupKind = "customerCode" | "phone" | "wechatId" | "email";

type ProtectedLookup = {
  kind: ProtectedLookupKind;
  value: string;
};

type SearchMode = "broad" | ProtectedLookupKind;

type Props = {
  customerId: string;
  currentCustomerName: string;
  open: boolean;
  onClose: () => void;
};

export function CustomerFamilyLinkExistingModal({
  customerId,
  currentCustomerName,
  open,
  onClose,
}: Props) {
  const router = useRouter();
  const { t } = useCustomerLabels();
  const [step, setStep] = useState(1);
  const [relationshipType, setRelationshipType] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("broad");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedVisible, setSelectedVisible] = useState<VisibleCandidate | null>(
    null,
  );
  const [protectedLookup, setProtectedLookup] = useState<ProtectedLookup | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const relationshipOptions = useMemo(
    () =>
      HOUSEHOLD_RELATIONSHIP_TYPES.map((value) => ({
        value,
        label: t(`householdRelationships.${value}`),
      })),
    [t],
  );

  const searchPlaceholder = useMemo(() => {
    if (searchMode === "broad") {
      return t("customers.familySearchPlaceholder");
    }
    return t("customers.familyExactSearchPlaceholder");
  }, [searchMode, t]);

  const minQueryLength = searchMode === "broad" ? 2 : 1;

  const reset = useCallback(() => {
    setStep(1);
    setRelationshipType("");
    setSearchMode("broad");
    setQuery("");
    setDebouncedQuery("");
    setCandidates([]);
    setSelectedVisible(null);
    setProtectedLookup(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open || step !== 2 || debouncedQuery.length < minQueryLength) {
      setCandidates([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ q: debouncedQuery });
    if (searchMode === "broad") {
      params.set("mode", "broad");
    } else {
      params.set("mode", "exact");
      params.set("kind", searchMode);
    }

    void fetch(`/api/customers/${customerId}/family/candidates?${params.toString()}`)
      .then(async (res) => {
        const data = (await res.json()) as {
          candidates?: Candidate[];
          error?: string;
          errorCode?: string;
        };
        if (!res.ok) {
          throw new Error(resolveApiError(t, data));
        }
        if (!cancelled) {
          setCandidates(data.candidates ?? []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("common.networkError"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, step, debouncedQuery, customerId, t, searchMode, minQueryLength]);

  function selectCandidate(candidate: Candidate) {
    if (candidate.isMasked) {
      if (searchMode === "broad") {
        return;
      }
      setSelectedVisible(null);
      setProtectedLookup({ kind: searchMode, value: query.trim() });
    } else {
      setSelectedVisible(candidate);
      setProtectedLookup(null);
    }
    setStep(3);
    setError(null);
  }

  async function handleSubmit() {
    if (!relationshipType) return;
    setSubmitting(true);
    setError(null);

    const body = protectedLookup
      ? { relationshipType, protectedLookup }
      : selectedVisible
        ? {
            relationshipType,
            targetCustomerId: selectedVisible.customerId,
          }
        : null;

    if (!body) {
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/customers/${customerId}/family/link-existing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        mode?: string;
        error?: string;
        errorCode?: string;
      };

      if (!res.ok) {
        setError(resolveApiError(t, data));
        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  const reviewTargetName = selectedVisible?.customerName;
  const requiresApproval =
    selectedVisible?.linkMode === "approval" || protectedLookup != null;

  if (!open) {
    return null;
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <h3 className="text-lg font-semibold crm-text">
          {t("customers.addFamilyMember")}
        </h3>
        <p className="mt-1 text-sm crm-text-secondary">
          {t("customers.familyWizardStep", { step: String(step), total: "3" })}
        </p>

        {step === 1 && (
          <div className="mt-4 space-y-4">
            <Field>
              <Label htmlFor="family-relationship">
                {t("customers.familyRelationshipLabel")}
              </Label>
              <Select
                id="family-relationship"
                value={relationshipType}
                onChange={(event) => setRelationshipType(event.target.value)}
              >
                <option value="">{t("customers.familyRelationshipPlaceholder")}</option>
                {relationshipOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs crm-text-muted">{t("customers.familyRelationshipHelper")}</p>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4 space-y-4">
            <Field>
              <Label htmlFor="family-search-mode">
                {t("customers.familySearchModeLabel")}
              </Label>
              <Select
                id="family-search-mode"
                value={searchMode}
                onChange={(event) => {
                  setSearchMode(event.target.value as SearchMode);
                  setCandidates([]);
                  setError(null);
                }}
              >
                <option value="broad">{t("customers.familySearchModeBroad")}</option>
                <option value="customerCode">
                  {t("customers.familySearchModeCustomerCode")}
                </option>
                <option value="phone">{t("customers.familySearchModePhone")}</option>
                <option value="wechatId">{t("customers.familySearchModeWechat")}</option>
                <option value="email">{t("customers.familySearchModeEmail")}</option>
              </Select>
            </Field>
            <Field>
              <Label htmlFor="family-search">{t("customers.familySearchLabel")}</Label>
              <Input
                id="family-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
              />
            </Field>
            {loading && (
              <p className="text-sm crm-text-secondary">{t("common.loading")}</p>
            )}
            <ul className="divide-y divide-[var(--crm-border)] rounded-lg border border-[var(--crm-border)]">
              {candidates.map((candidate, index) => (
                <li key={index}>
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left hover:bg-[var(--crm-surface-muted)]"
                    onClick={() => selectCandidate(candidate)}
                  >
                    {candidate.isMasked ? (
                      <div>
                        <p className="text-sm crm-text">{t("customers.familyProtectedCandidateTitle")}</p>
                        <p className="mt-0.5 text-xs crm-text-muted">
                          {t("customers.familyProtectedCandidateSubtitle")}
                        </p>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <p className="truncate text-sm crm-text">{candidate.customerName}</p>
                        <p className="mt-0.5 text-xs crm-text-muted">
                          {t("customers.familyCandidateCreatedAt", {
                            time: formatHongKongDateTime(candidate.createdAt),
                          })}
                        </p>
                      </div>
                    )}
                    {(candidate.isMasked || candidate.linkMode === "approval") && (
                      <span className="shrink-0 text-xs crm-text-muted">
                        {t("customers.familyRequiresApproval")}
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {!loading && debouncedQuery.length >= minQueryLength && candidates.length === 0 && (
                <li className="px-3 py-4 text-sm crm-text-secondary">
                  {t("customers.familySearchNoResults")}
                </li>
              )}
            </ul>
          </div>
        )}

        {step === 3 && (
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <p className="crm-text-secondary">{t("customers.familyReviewCurrent")}</p>
              <p className="crm-text">{currentCustomerName}</p>
            </div>
            <div>
              <p className="crm-text-secondary">{t("customers.familyReviewTarget")}</p>
              <p className="crm-text">
                {protectedLookup
                  ? t("customers.familyProtectedCandidateTitle")
                  : reviewTargetName}
              </p>
            </div>
            <div>
              <p className="crm-text-secondary">{t("customers.familyReviewRelationship")}</p>
              <p className="crm-text">{t(`householdRelationships.${relationshipType}`)}</p>
            </div>
            <p className="text-xs crm-text-muted">
              {requiresApproval
                ? protectedLookup
                  ? t("customers.familyProtectedReviewCopy")
                  : t("customers.familyApprovalReviewCopy")
                : t("customers.familyDirectReviewCopy")}
            </p>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {step > 1 && step < 3 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStep((current) => Math.max(1, current - 1))}
            >
              {t("common.back")}
            </Button>
          )}
          {step === 1 ? (
            <Button
              type="button"
              disabled={!relationshipType}
              onClick={() => setStep(2)}
            >
              {t("common.next")}
            </Button>
          ) : step === 3 ? (
            <Button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
              {requiresApproval
                ? t("customers.familySubmitApproval")
                : t("customers.familyConfirmLink")}
            </Button>
          ) : null}
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
