"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import {
  GLOBAL_IDLE_EXEMPTION_API_PATH,
  buildGlobalIdleExemptionPatchBody,
  parseGlobalIdleExemptionGetResponse,
  parseGlobalIdleExemptionPatchResponse,
  planGlobalIdleExemptionSwitchClick,
  shouldDisableSwitchControls,
} from "@/lib/settings/global-idle-exemption-ui";

export function GlobalIdleExemptionSetting() {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error" | null>(
    null,
  );
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setMessage(null);
    setMessageTone(null);
    try {
      const res = await fetch(GLOBAL_IDLE_EXEMPTION_API_PATH, {
        cache: "no-store",
      });
      const data = (await res.json()) as unknown;
      const parsed = parseGlobalIdleExemptionGetResponse(data);
      if (!res.ok || !parsed.ok) {
        setLoadError(true);
        setMessage(t("settings.globalIdleExemption.loadFailed"));
        setMessageTone("error");
        return;
      }
      setEnabled(parsed.enabled);
    } catch {
      setLoadError(true);
      setMessage(t("settings.globalIdleExemption.loadFailed"));
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const persistEnabled = useCallback(
    async (nextEnabled: boolean) => {
      if (savingRef.current) return false;
      savingRef.current = true;
      setSaving(true);
      setMessage(null);
      setMessageTone(null);

      const body = buildGlobalIdleExemptionPatchBody(nextEnabled);

      try {
        const res = await fetch(GLOBAL_IDLE_EXEMPTION_API_PATH, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as unknown;
        const parsed = parseGlobalIdleExemptionPatchResponse(data, res.ok);
        if (!parsed.ok) {
          setMessage(t("settings.globalIdleExemption.saveFailed"));
          setMessageTone("error");
          return false;
        }
        setEnabled(parsed.enabled);
        setMessage(
          parsed.enabled
            ? t("settings.globalIdleExemption.enableSuccess")
            : t("settings.globalIdleExemption.disableSuccess"),
        );
        setMessageTone("success");
        return true;
      } catch {
        setMessage(t("settings.globalIdleExemption.saveFailed"));
        setMessageTone("error");
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [t],
  );

  async function handleSwitchClick() {
    if (
      shouldDisableSwitchControls({ loading, saving, loadError }) ||
      savingRef.current
    ) {
      return;
    }

    const plan = planGlobalIdleExemptionSwitchClick(enabled, !enabled);
    if (plan.action === "noop") {
      return;
    }
    if (plan.action === "open_disable_confirm") {
      setConfirmOpen(true);
      return;
    }

    const previous = enabled;
    setEnabled(true);
    const ok = await persistEnabled(true);
    if (!ok) {
      setEnabled(previous);
    }
  }

  function handleCancelConfirm() {
    if (saving) return;
    setConfirmOpen(false);
  }

  async function handleConfirmDisable() {
    if (savingRef.current || saving) return;
    const ok = await persistEnabled(false);
    if (ok) {
      setConfirmOpen(false);
    }
  }

  const controlsDisabled = shouldDisableSwitchControls({
    loading,
    saving,
    loadError,
  });

  return (
    <section className="surface-card p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 max-w-3xl flex-1">
          <h3
            id={titleId}
            className="text-base font-semibold text-[#172033]"
          >
            {t("settings.globalIdleExemption.title")}
          </h3>
          <p
            id={descriptionId}
            className="mt-2 text-sm leading-relaxed text-[#6B7890]"
          >
            {t("settings.globalIdleExemption.description")}
          </p>
        </div>

        <div className="flex-shrink-0 sm:pt-0.5">
          {loading ? (
            <p className="text-sm text-[#6B7890]">
              {t("settings.globalIdleExemption.loading")}
            </p>
          ) : (
            <div className="mt-1">
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                disabled={controlsDisabled}
                onClick={() => void handleSwitchClick()}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  enabled ? "bg-[#2563EB]" : "bg-[#CBD5E1] dark:bg-[#3A4459]"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    enabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
              <p className="mt-1 text-xs text-[#6B7890]">
                {enabled
                  ? t("settings.globalIdleExemption.statusOn")
                  : t("settings.globalIdleExemption.statusOff")}
              </p>
            </div>
          )}
        </div>
      </div>

      {message ? (
        <p
          className={`mt-4 text-sm ${
            messageTone === "error" ? "text-red-600" : "text-[#6B7890]"
          }`}
          role={messageTone === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}

      {confirmOpen ? (
        <ModalOverlay onClose={saving ? undefined : handleCancelConfirm}>
          <ModalPanel className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={dialogTitleId}
              aria-describedby={dialogDescriptionId}
            >
              <h3
                id={dialogTitleId}
                className="text-lg font-medium text-[#172033]"
              >
                {t("settings.globalIdleExemption.confirmTitle")}
              </h3>
              <p
                id={dialogDescriptionId}
                className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[#6B7890]"
              >
                {t("settings.globalIdleExemption.confirmDescription")}
              </p>
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  disabled={saving}
                  onClick={handleCancelConfirm}
                >
                  {t("settings.globalIdleExemption.confirmCancel")}
                </Button>
                <Button
                  type="button"
                  className="w-full whitespace-normal sm:w-auto"
                  disabled={saving}
                  onClick={() => void handleConfirmDisable()}
                >
                  {saving
                    ? t("settings.globalIdleExemption.saving")
                    : t("settings.globalIdleExemption.confirmSubmit")}
                </Button>
              </div>
            </div>
          </ModalPanel>
        </ModalOverlay>
      ) : null}
    </section>
  );
}
