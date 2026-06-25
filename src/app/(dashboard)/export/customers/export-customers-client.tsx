"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";
import {
  DEFAULT_EXPORT_FIELDS,
  EXPORT_SCOPES,
  requiresExportRiskConfirmation,
  type ExportScope,
} from "@/lib/export/customers/constants";

export function ExportCustomersClient() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<ExportScope>("all_active");
  const [includeSensitive, setIncludeSensitive] = useState(true);
  const [showRiskDialog, setShowRiskDialog] = useState(false);
  const [riskConfirmed, setRiskConfirmed] = useState(false);

  const needsRiskConfirmation = requiresExportRiskConfirmation(
    scope,
    includeSensitive,
  );

  useEffect(() => {
    setRiskConfirmed(false);
    setShowRiskDialog(false);
  }, [scope, includeSensitive]);

  function doExport() {
    const params = new URLSearchParams({
      scope,
      includeSensitive: String(includeSensitive),
      fields: DEFAULT_EXPORT_FIELDS.join(","),
    });
    window.location.href = `/api/export/customers?${params}`;
  }

  function handleExportClick() {
    if (needsRiskConfirmation) {
      setRiskConfirmed(false);
      setShowRiskDialog(true);
      return;
    }
    doExport();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid max-w-lg gap-5">
        <Field>
          <Label htmlFor="scope">{t("export.scope")}</Label>
          <Select
            id="scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as ExportScope)}
          >
            {EXPORT_SCOPES.map((s) => (
              <option key={s} value={s}>
                {t(`export.scopes.${s}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeSensitive}
              onChange={(e) => setIncludeSensitive(e.target.checked)}
              className="rounded border-slate-300"
            />
            {t("export.includeSensitive")}
          </label>
          <p className="mt-1 text-xs text-slate-500">{t("export.sensitiveHint")}</p>
        </Field>

        <Field>
          <Label>{t("export.fieldsLabel")}</Label>
          <p className="text-sm text-slate-600">
            {t("export.defaultFieldsHint", {
              count: String(DEFAULT_EXPORT_FIELDS.length),
            })}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {DEFAULT_EXPORT_FIELDS.join(", ")}
          </p>
        </Field>

        <div>
          <Button onClick={handleExportClick}>{t("export.exportCsv")}</Button>
        </div>
      </div>

      {showRiskDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-risk-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3
              id="export-risk-title"
              className="text-lg font-semibold text-slate-900"
            >
              {t("export.riskTitle")}
            </h3>
            <p className="mt-3 text-sm text-slate-600">{t("export.riskMessage")}</p>
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={riskConfirmed}
                onChange={(e) => setRiskConfirmed(e.target.checked)}
                className="mt-0.5 rounded border-slate-300"
              />
              <span>{t("export.riskConfirm")}</span>
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowRiskDialog(false);
                  setRiskConfirmed(false);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button disabled={!riskConfirmed} onClick={doExport}>
                {t("export.confirmExport")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1">{children}</div>;
}
