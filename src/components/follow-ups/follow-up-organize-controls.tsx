"use client";

import { useEffect, useRef, useState } from "react";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { organizeFollowUpTextBasic } from "@/lib/ai/follow-up-organize/basic";
import type {
  FollowUpOrganizationResult,
  FollowUpOrganizeAvailability,
} from "@/lib/ai/follow-up-organize/types";
import { FOLLOW_UP_ORGANIZE_MIN_LENGTH } from "@/lib/ai/follow-up-organize/types";

type Props = {
  value: string;
  onApply: (organizedText: string) => void;
  /** When set, uses customer-scoped API. When null, uses draft create API. */
  customerId: string | null;
};

function availabilityMessageKey(
  reason: FollowUpOrganizeAvailability["reason"],
): string {
  switch (reason) {
    case "STAFF_DISABLED":
      return "followUpOrganize.availability.staffDisabled";
    case "LIMIT_REACHED":
      return "followUpOrganize.availability.limitReached";
    case "GLOBAL_DISABLED":
      return "followUpOrganize.availability.globalDisabled";
    case "PROVIDER_UNAVAILABLE":
      return "followUpOrganize.availability.providerUnavailable";
    case "MOCK_ONLY":
      return "followUpOrganize.availability.mockOnly";
    default:
      return "followUpOrganize.availability.available";
  }
}

export function FollowUpOrganizeControls({
  value,
  onApply,
  customerId,
}: Props) {
  const { t } = useCustomerLabels();
  const [availability, setAvailability] =
    useState<FollowUpOrganizeAvailability | null>(null);
  const [loadingMode, setLoadingMode] = useState<"basic" | "ai" | null>(null);
  const [preview, setPreview] = useState<FollowUpOrganizationResult | null>(
    null,
  );
  /** Snapshot of textarea at organize time — useResult must match current value. */
  const [previewSourceText, setPreviewSourceText] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [lastMode, setLastMode] = useState<"basic" | "ai">("basic");
  /** Persist key for a single in-flight AI attempt (network uncertainty). */
  const inFlightKeyRef = useRef<string | null>(null);

  const canBasic = value.trim().length >= FOLLOW_UP_ORGANIZE_MIN_LENGTH;
  const canAi = availability?.canUseAi === true;
  const previewStale =
    preview !== null &&
    previewSourceText !== null &&
    previewSourceText !== value;

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setPreviewSourceText(null);
    setError(null);

    const endpoint = customerId
      ? `/api/customers/${customerId}/follow-ups/organize`
      : `/api/ai/follow-up-organize`;

    void (async () => {
      try {
        const response = await fetch(endpoint, { method: "GET" });
        if (!response.ok) return;
        const data = (await response.json()) as {
          availability?: FollowUpOrganizeAvailability;
        };
        if (!cancelled && data.availability) {
          setAvailability(data.availability);
        }
      } catch {
        // Availability is best-effort; AI click still hits the server.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customerId]);

  async function runOrganize(mode: "basic" | "ai") {
    setError(null);
    setLastMode(mode);
    setLoadingMode(mode);

    const sourceText = value;

    try {
      if (mode === "basic") {
        const result = organizeFollowUpTextBasic(sourceText);
        if (
          !result.organizedText &&
          result.warnings.some((w) => w.code === "INPUT_EMPTY")
        ) {
          setError(t("followUpOrganize.warnings.inputEmpty"));
          return;
        }
        setPreviewSourceText(sourceText);
        setPreview(result);
        return;
      }

      const endpoint = customerId
        ? `/api/customers/${customerId}/follow-ups/organize`
        : `/api/ai/follow-up-organize`;
      // New user action → new key. Do not auto-retry with a different key.
      const reservationKey = crypto.randomUUID();
      inFlightKeyRef.current = reservationKey;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": reservationKey,
        },
        body: JSON.stringify({ mode: "ai", text: sourceText }),
      });
      const data = (await response.json()) as {
        result?: FollowUpOrganizationResult;
        availability?: FollowUpOrganizeAvailability;
        error?: string;
        errorCode?: string;
      };
      if (data.availability) {
        setAvailability(data.availability);
      }
      if (!response.ok || !data.result) {
        if (data.errorCode === "AI_STAFF_RESERVATION_CONFLICT") {
          setError(t("followUpOrganize.errors.idempotencyConflict"));
        } else {
          setError(
            data.error || t("followUpOrganize.errors.organizationFailed"),
          );
        }
        return;
      }
      if (data.result.source === "mock") {
        setError(t("followUpOrganize.availability.mockOnly"));
        return;
      }
      setPreviewSourceText(sourceText);
      setPreview(data.result);
    } catch {
      setError(t("followUpOrganize.errors.network"));
    } finally {
      inFlightKeyRef.current = null;
      setLoadingMode(null);
    }
  }

  function closePreview() {
    setPreview(null);
    setPreviewSourceText(null);
  }

  function keepOriginal() {
    setPreview(null);
    setPreviewSourceText(null);
  }

  function useResult() {
    if (!preview || previewSourceText === null) return;
    if (previewSourceText !== value) {
      setError(t("followUpOrganize.errors.previewStale"));
      return;
    }
    onApply(preview.organizedText);
    setPreview(null);
    setPreviewSourceText(null);
  }

  const sourceLabel =
    preview?.source === "external_ai"
      ? t("followUpOrganize.sourceAi")
      : preview?.source === "mock"
        ? t("followUpOrganize.sourceMock")
        : t("followUpOrganize.sourceBasic");

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canBasic || loadingMode !== null}
          onClick={() => void runOrganize("basic")}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        >
          {loadingMode === "basic"
            ? t("followUpOrganize.organizing")
            : t("followUpOrganize.basicButton")}
        </button>
        <button
          type="button"
          disabled={!canBasic || !canAi || loadingMode !== null}
          onClick={() => void runOrganize("ai")}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        >
          {loadingMode === "ai"
            ? t("followUpOrganize.organizing")
            : t("followUpOrganize.aiButton")}
        </button>
        <span className="text-[11px] text-slate-500">
          {t("followUpOrganize.basicHint")}
          {" · "}
          {t("followUpOrganize.aiHint")}
        </span>
      </div>

      {availability && !availability.canUseAi && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {t(availabilityMessageKey(availability.reason))}
        </p>
      )}

      {availability?.canUseAi && availability.remaining !== null && (
        <p className="text-xs text-slate-500">
          {t("followUpOrganize.remainingToday", {
            count: String(availability.remaining),
          })}
        </p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {preview && (
        <ModalOverlay onClose={closePreview}>
          <ModalPanel className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t("followUpOrganize.previewTitle")}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {sourceLabel} · {t("followUpOrganize.resultNotSavedYet")}
            </p>
            {previewStale && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                {t("followUpOrganize.errors.previewStale")}
              </p>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-slate-500">
                  {t("followUpOrganize.originalText")}
                </p>
                <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {preview.originalText}
                </pre>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">
                  {t("followUpOrganize.organizedText")}
                </p>
                <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-emerald-50 p-3 text-sm text-slate-800 dark:bg-emerald-950/40 dark:text-slate-100">
                  {preview.organizedText}
                </pre>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-xs font-medium text-slate-500">
                {t("followUpOrganize.extractedInformation")}
              </p>
              <ul className="mt-1 space-y-1 text-sm text-slate-700 dark:text-slate-200">
                {preview.extracted.businessNeed && (
                  <li>
                    {t("followUpOrganize.businessNeed")}:{" "}
                    {preview.extracted.businessNeed}
                  </li>
                )}
                {preview.extracted.concerns.map((item) => (
                  <li key={item}>
                    {t("followUpOrganize.customerConcern")}: {item}
                  </li>
                ))}
                {preview.extracted.documentStatus.map((item) => (
                  <li key={item}>
                    {t("followUpOrganize.documentStatus")}: {item}
                  </li>
                ))}
                {preview.extracted.agreedFollowUpAt && (
                  <li>
                    {t("followUpOrganize.agreedFollowUpTime")}:{" "}
                    {preview.extracted.agreedFollowUpAt.rawText}
                  </li>
                )}
                {preview.extracted.nextAction && (
                  <li>
                    {t("followUpOrganize.suggestedNextAction")}:{" "}
                    {preview.extracted.nextAction}
                  </li>
                )}
                {!preview.extracted.businessNeed &&
                  preview.extracted.concerns.length === 0 &&
                  preview.extracted.documentStatus.length === 0 &&
                  !preview.extracted.agreedFollowUpAt &&
                  !preview.extracted.nextAction && (
                    <li className="text-slate-500">
                      {t("followUpOrganize.noExtracted")}
                    </li>
                  )}
              </ul>
            </div>

            {preview.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-300">
                {preview.warnings.map((w) => (
                  <li key={w.code}>{t(w.messageKey)}</li>
                ))}
              </ul>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={useResult}
                disabled={previewStale}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
              >
                {t("followUpOrganize.useOrganizedResult")}
              </button>
              <button
                type="button"
                onClick={keepOriginal}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-600"
              >
                {t("followUpOrganize.keepOriginal")}
              </button>
              <button
                type="button"
                onClick={() => void runOrganize(lastMode)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-600"
              >
                {t("followUpOrganize.organizeAgain")}
              </button>
              <button
                type="button"
                onClick={closePreview}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-600"
              >
                {t("followUpOrganize.closePreview")}
              </button>
            </div>
          </ModalPanel>
        </ModalOverlay>
      )}
    </div>
  );
}
