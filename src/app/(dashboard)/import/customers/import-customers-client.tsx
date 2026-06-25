"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/form";
import type { ImportIssue, ImportPreviewRow } from "@/lib/import/customers/types";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { resolveImportIssue } from "@/i18n/resolve-import-issue";

type PrecheckResponse = {
  jobId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  previewRows: ImportPreviewRow[];
};

type CommitResponse = {
  jobId: string;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  createdCustomerIds: string[];
  errors: ImportIssue[];
  warnings?: ImportIssue[];
  error?: string;
  code?: string;
  errorCode?: string;
};

export function ImportCustomersClient() {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState<"precheck" | "commit" | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [precheck, setPrecheck] = useState<PrecheckResponse | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setFileName(file.name);
    setPrecheck(null);
    setCommitResult(null);
    setServerError(null);
  }

  async function runPrecheck() {
    if (!csvText.trim()) {
      setServerError(t("imports.chooseFileFirst"));
      return;
    }

    setLoading("precheck");
    setServerError(null);
    setPrecheck(null);
    setCommitResult(null);

    try {
      const res = await fetch("/api/import/customers/precheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText, fileName }),
      });
      const data = (await res.json()) as PrecheckResponse & {
        error?: string;
        errorCode?: string;
        code?: string;
      };
      if (!res.ok) {
        setServerError(resolveApiError(t, data));
        return;
      }
      setPrecheck(data);
    } catch {
      setServerError(t("common.networkError"));
    } finally {
      setLoading(null);
    }
  }

  async function runCommit() {
    if (!csvText.trim() || !precheck) return;

    setLoading("commit");
    setServerError(null);

    try {
      const res = await fetch("/api/import/customers/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvText,
          fileName,
          jobId: precheck.jobId,
        }),
      });
      const data = (await res.json()) as CommitResponse;
      if (!res.ok) {
        setServerError(resolveApiError(t, data));
        return;
      }
      setCommitResult(data);
    } catch {
      setServerError(t("common.networkError"));
    } finally {
      setLoading(null);
    }
  }

  const canCommit =
    precheck &&
    precheck.invalidRows === 0 &&
    precheck.errors.length === 0 &&
    precheck.validRows > 0;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">{t("imports.supportedFormat")}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = "/api/import/customers/template";
            }}
          >
            {t("imports.downloadTemplate")}
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            {t("imports.chooseFile")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileChange}
          />
          {fileName && (
            <span className="text-sm text-slate-500">
              {t("imports.selectedFile", { name: fileName })}
            </span>
          )}
        </div>

        <div className="mt-4">
          <Label htmlFor="csvText">{t("imports.pasteCsv")}</Label>
          <Textarea
            id="csvText"
            rows={8}
            className="mt-1 font-mono text-sm"
            placeholder="customer_name,customer_type,..."
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setPrecheck(null);
              setCommitResult(null);
              setServerError(null);
            }}
          />
        </div>

        <div className="mt-4 flex gap-3">
          <Button onClick={runPrecheck} disabled={loading !== null}>
            {loading === "precheck" ? t("imports.prechecking") : t("imports.precheck")}
          </Button>
          {canCommit && (
            <Button variant="primary" onClick={runCommit} disabled={loading !== null}>
              {loading === "commit" ? t("imports.importing") : t("imports.confirmImport")}
            </Button>
          )}
        </div>

        {serverError && <p className="mt-3 text-sm text-red-600">{serverError}</p>}
      </div>

      {precheck && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-medium text-slate-900">{t("imports.precheckResults")}</h3>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label={t("imports.totalRows")} value={precheck.totalRows} />
            <Stat label={t("imports.validRows")} value={precheck.validRows} />
            <Stat label={t("imports.invalidRows")} value={precheck.invalidRows} />
            <Stat label={t("imports.duplicateRows")} value={precheck.duplicateRows} />
          </dl>

          {precheck.errors.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-medium text-slate-900">{t("imports.errorDetails")}</h4>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="px-3 py-2">{t("imports.row")}</th>
                      <th className="px-3 py-2">{t("imports.field")}</th>
                      <th className="px-3 py-2">{t("imports.code")}</th>
                      <th className="px-3 py-2">{t("imports.errorReason")}</th>
                      <th className="px-3 py-2">{t("imports.value")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {precheck.errors.map((err, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="px-3 py-2">{err.rowNumber}</td>
                        <td className="px-3 py-2">{err.field}</td>
                        <td className="px-3 py-2 font-mono text-xs">{err.code}</td>
                        <td className="px-3 py-2">{resolveImportIssue(t, err)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{err.value ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {precheck.warnings.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-medium text-amber-700">{t("imports.warningsTitle")}</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
                {precheck.warnings.map((w, i) => (
                  <li key={i}>
                    {t("imports.warningRow", {
                      row: String(w.rowNumber),
                      message: resolveImportIssue(t, w),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {precheck.previewRows.length === 0 && precheck.errors.length === 0 && (
            <p className="mt-4 text-sm text-slate-500">{t("imports.noPreviewData")}</p>
          )}
        </div>
      )}

      {commitResult && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-6">
          <h3 className="text-lg font-medium text-green-900">{t("imports.importSuccess")}</h3>
          <p className="mt-2 text-sm text-green-800">
            {t("imports.importedCount", { count: String(commitResult.importedCount) })}
          </p>
          {commitResult.createdCustomerIds.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-green-900">
              {commitResult.createdCustomerIds.map((id) => (
                <li key={id}>
                  <a href={`/customers/${id}`} className="underline">
                    {id}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
