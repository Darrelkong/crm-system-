"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import {
  ADMIN_QUICK_ENTRY_API_PATH,
  adminRequestBodyHasForbiddenKeys,
  adminResponseExposesSecrets,
  buildSetCodeBody,
  buildSetEnabledBody,
  formatQuickEntryCodeUpdatedAt,
  mapAdminQuickEntryErrorCode,
  parseAdminErrorCode,
  parseAdminQuickEntryState,
  planAdminQuickEntrySwitchClick,
  shouldDisableAdminQuickEntryControls,
  validateClientQuickEntryCodePair,
  type AdminQuickEntryState,
} from "@/lib/settings/public-pool-quick-entry-settings-ui";

const EMPTY_STATE: AdminQuickEntryState = {
  enabled: false,
  hasCode: false,
  codeUpdatedAt: null,
  updatedBy: null,
};

export function PublicPoolQuickEntrySettingsCard() {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const codeDialogTitleId = useId();
  const disableDialogTitleId = useId();
  const disableDialogDescId = useId();
  const codeInputId = useId();
  const confirmInputId = useId();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [state, setState] = useState<AdminQuickEntryState>(EMPTY_STATE);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error" | null>(
    null,
  );
  const [codeDialogOpen, setCodeDialogOpen] = useState(false);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [code, setCode] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [codeFormError, setCodeFormError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const clearCodeInputs = useCallback(() => {
    setCode("");
    setConfirmCode("");
    setCodeFormError(null);
  }, []);

  const applyState = useCallback((next: AdminQuickEntryState) => {
    setState(next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setMessage(null);
    setMessageTone(null);
    try {
      const res = await fetch(ADMIN_QUICK_ENTRY_API_PATH, { cache: "no-store" });
      const data = (await res.json()) as unknown;
      if (adminResponseExposesSecrets(data)) {
        setLoadError(true);
        setMessage(t("settings.publicPoolQuickEntry.loadFailed"));
        setMessageTone("error");
        return;
      }
      const parsed = parseAdminQuickEntryState(data);
      if (!res.ok || !parsed.ok) {
        setLoadError(true);
        setMessage(t("settings.publicPoolQuickEntry.loadFailed"));
        setMessageTone("error");
        return;
      }
      applyState(parsed.state);
    } catch {
      setLoadError(true);
      setMessage(t("settings.publicPoolQuickEntry.loadFailed"));
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }, [applyState, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const persistEnabled = useCallback(
    async (enabled: boolean) => {
      if (savingRef.current) return false;
      savingRef.current = true;
      setSaving(true);
      setMessage(null);
      setMessageTone(null);

      const body = buildSetEnabledBody(enabled);
      if (adminRequestBodyHasForbiddenKeys(body as Record<string, unknown>)) {
        setMessage(t("settings.publicPoolQuickEntry.saveFailed"));
        setMessageTone("error");
        savingRef.current = false;
        setSaving(false);
        return false;
      }

      try {
        const res = await fetch(ADMIN_QUICK_ENTRY_API_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as unknown;
        if (adminResponseExposesSecrets(data)) {
          setMessage(t("settings.publicPoolQuickEntry.saveFailed"));
          setMessageTone("error");
          return false;
        }
        const parsed = parseAdminQuickEntryState(data);
        if (!res.ok || !parsed.ok) {
          const mapped = mapAdminQuickEntryErrorCode(parseAdminErrorCode(data));
          if (mapped === "not_configured") {
            setMessage(t("settings.publicPoolQuickEntry.needCodeBeforeEnable"));
          } else {
            setMessage(t("settings.publicPoolQuickEntry.saveFailed"));
          }
          setMessageTone("error");
          return false;
        }
        applyState(parsed.state);
        setMessage(
          enabled
            ? t("settings.publicPoolQuickEntry.enableSuccess")
            : t("settings.publicPoolQuickEntry.disableSuccess"),
        );
        setMessageTone("success");
        return true;
      } catch {
        setMessage(t("settings.publicPoolQuickEntry.saveFailed"));
        setMessageTone("error");
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [applyState, t],
  );

  async function handleSwitchClick() {
    if (
      shouldDisableAdminQuickEntryControls({ loading, saving, loadError }) ||
      savingRef.current
    ) {
      return;
    }
    const plan = planAdminQuickEntrySwitchClick({
      currentEnabled: state.enabled,
      nextEnabled: !state.enabled,
      hasCode: state.hasCode,
    });
    if (plan.action === "noop") return;
    if (plan.action === "block_need_code") {
      setMessage(t("settings.publicPoolQuickEntry.needCodeBeforeEnable"));
      setMessageTone("error");
      return;
    }
    if (plan.action === "open_disable_confirm") {
      setDisableConfirmOpen(true);
      return;
    }
    const previous = state.enabled;
    setState((s) => ({ ...s, enabled: true }));
    const ok = await persistEnabled(true);
    if (!ok) {
      setState((s) => ({ ...s, enabled: previous }));
    }
  }

  async function handleConfirmDisable() {
    if (savingRef.current || saving) return;
    const ok = await persistEnabled(false);
    if (ok) setDisableConfirmOpen(false);
  }

  function openCodeDialog() {
    clearCodeInputs();
    setCodeDialogOpen(true);
  }

  function closeCodeDialog() {
    if (saving) return;
    setCodeDialogOpen(false);
    clearCodeInputs();
  }

  async function handleSubmitCode() {
    if (savingRef.current || saving) return;
    const client = validateClientQuickEntryCodePair(code, confirmCode);
    if (!client.ok) {
      if (client.reason === "empty") {
        setCodeFormError(t("settings.publicPoolQuickEntry.codeRequired"));
      } else if (client.reason === "mismatch") {
        setCodeFormError(t("settings.publicPoolQuickEntry.codeMismatch"));
      } else {
        setCodeFormError(t("settings.publicPoolQuickEntry.codeFormat"));
      }
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setCodeFormError(null);
    setMessage(null);
    setMessageTone(null);

    const body = buildSetCodeBody(code, confirmCode);
    try {
      const res = await fetch(ADMIN_QUICK_ENTRY_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as unknown;
      if (adminResponseExposesSecrets(data)) {
        setCodeFormError(t("settings.publicPoolQuickEntry.saveFailed"));
        return;
      }
      const parsed = parseAdminQuickEntryState(data);
      if (!res.ok || !parsed.ok) {
        const mapped = mapAdminQuickEntryErrorCode(parseAdminErrorCode(data));
        if (mapped === "mismatch") {
          setCodeFormError(t("settings.publicPoolQuickEntry.codeMismatch"));
        } else if (mapped === "format") {
          setCodeFormError(t("settings.publicPoolQuickEntry.codeFormat"));
        } else {
          setCodeFormError(t("settings.publicPoolQuickEntry.saveFailed"));
        }
        return;
      }
      applyState(parsed.state);
      setCodeDialogOpen(false);
      clearCodeInputs();
      setMessage(t("settings.publicPoolQuickEntry.codeResetSuccess"));
      setMessageTone("success");
    } catch {
      setCodeFormError(t("settings.publicPoolQuickEntry.saveFailed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const controlsDisabled = shouldDisableAdminQuickEntryControls({
    loading,
    saving,
    loadError,
  });

  const updatedByLabel = state.updatedBy
    ? state.updatedBy.name
    : t("settings.publicPoolQuickEntry.updatedByNone");

  return (
    <section className="surface-card p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 max-w-3xl flex-1">
          <h3
            id={titleId}
            className="text-base font-semibold text-[#172033]"
          >
            {t("settings.publicPoolQuickEntry.title")}
          </h3>
          <p
            id={descriptionId}
            className="mt-2 text-sm leading-relaxed text-[#6B7890]"
          >
            {t("settings.publicPoolQuickEntry.description")}
          </p>
        </div>

        <div className="flex-shrink-0 sm:pt-0.5">
          {loading ? (
            <p className="text-sm text-[#6B7890]">
              {t("settings.publicPoolQuickEntry.loading")}
            </p>
          ) : (
            <div className="mt-1">
              <button
                type="button"
                role="switch"
                aria-checked={state.enabled}
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                disabled={controlsDisabled}
                onClick={() => void handleSwitchClick()}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  state.enabled
                    ? "bg-[#2563EB]"
                    : "bg-[#CBD5E1] dark:bg-[#3A4459]"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    state.enabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
              <p className="mt-1 text-xs text-[#6B7890]">
                {state.enabled
                  ? t("settings.statusEnabled")
                  : t("settings.statusDisabled")}
              </p>
            </div>
          )}
        </div>
      </div>

      {!loading ? (
        <div className="mt-5 grid max-w-lg gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[#6B7890]">
              {t("settings.publicPoolQuickEntry.codeStatusLabel")}
            </span>
            <Badge variant={state.hasCode ? "success" : "default"}>
              {state.hasCode
                ? t("settings.publicPoolQuickEntry.codeConfigured")
                : t("settings.publicPoolQuickEntry.codeNotConfigured")}
            </Badge>
          </div>
          <div>
            <span className="text-[#6B7890]">
              {t("settings.publicPoolQuickEntry.updatedAtLabel")}
            </span>{" "}
            <span className="text-[#172033]">
              {formatQuickEntryCodeUpdatedAt(
                state.codeUpdatedAt,
                t("settings.publicPoolQuickEntry.updatedAtNone"),
              )}
            </span>
          </div>
          <div>
            <span className="text-[#6B7890]">
              {t("settings.publicPoolQuickEntry.updatedByLabel")}
            </span>{" "}
            <span className="text-[#172033]">{updatedByLabel}</span>
          </div>
        </div>
      ) : null}

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

      <div className="mt-5">
        <Button
          type="button"
          variant="secondary"
          disabled={controlsDisabled}
          onClick={openCodeDialog}
        >
          {state.hasCode
            ? t("settings.publicPoolQuickEntry.resetCode")
            : t("settings.publicPoolQuickEntry.setCode")}
        </Button>
      </div>

      {codeDialogOpen ? (
        <ModalOverlay onClose={saving ? undefined : closeCodeDialog}>
          <ModalPanel className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={codeDialogTitleId}
            >
              <h3
                id={codeDialogTitleId}
                className="text-lg font-medium text-[#172033]"
              >
                {state.hasCode
                  ? t("settings.publicPoolQuickEntry.resetCodeTitle")
                  : t("settings.publicPoolQuickEntry.setCodeTitle")}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#6B7890]">
                {t("settings.publicPoolQuickEntry.codeRules")}
              </p>
              <div className="mt-4 space-y-4">
                <div>
                  <Label htmlFor={codeInputId}>
                    {t("settings.publicPoolQuickEntry.newCode")}
                  </Label>
                  <Input
                    id={codeInputId}
                    type="password"
                    autoComplete="new-password"
                    value={code}
                    disabled={saving}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor={confirmInputId}>
                    {t("settings.publicPoolQuickEntry.confirmCode")}
                  </Label>
                  <Input
                    id={confirmInputId}
                    type="password"
                    autoComplete="new-password"
                    value={confirmCode}
                    disabled={saving}
                    onChange={(e) => setConfirmCode(e.target.value)}
                  />
                </div>
              </div>
              {codeFormError ? (
                <p className="mt-3 text-sm text-red-600" role="alert">
                  {codeFormError}
                </p>
              ) : null}
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  disabled={saving}
                  onClick={closeCodeDialog}
                >
                  {t("settings.publicPoolQuickEntry.cancel")}
                </Button>
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  disabled={saving}
                  onClick={() => void handleSubmitCode()}
                >
                  {saving
                    ? t("settings.publicPoolQuickEntry.saving")
                    : t("settings.publicPoolQuickEntry.saveCode")}
                </Button>
              </div>
            </div>
          </ModalPanel>
        </ModalOverlay>
      ) : null}

      {disableConfirmOpen ? (
        <ModalOverlay
          onClose={saving ? undefined : () => setDisableConfirmOpen(false)}
        >
          <ModalPanel className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={disableDialogTitleId}
              aria-describedby={disableDialogDescId}
            >
              <h3
                id={disableDialogTitleId}
                className="text-lg font-medium text-[#172033]"
              >
                {t("settings.publicPoolQuickEntry.disableConfirmTitle")}
              </h3>
              <p
                id={disableDialogDescId}
                className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[#6B7890]"
              >
                {t("settings.publicPoolQuickEntry.disableConfirmDescription")}
              </p>
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  disabled={saving}
                  onClick={() => setDisableConfirmOpen(false)}
                >
                  {t("settings.publicPoolQuickEntry.cancel")}
                </Button>
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  disabled={saving}
                  onClick={() => void handleConfirmDisable()}
                >
                  {saving
                    ? t("settings.publicPoolQuickEntry.saving")
                    : t("settings.publicPoolQuickEntry.disableConfirmSubmit")}
                </Button>
              </div>
            </div>
          </ModalPanel>
        </ModalOverlay>
      ) : null}
    </section>
  );
}
