"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/form";
import {
  DEFAULT_EXPORT_FIELDS,
  EXPORT_RISK_CONFIRMATION_MESSAGE,
  EXPORT_SCOPE_LABELS,
  EXPORT_SCOPES,
  requiresExportRiskConfirmation,
  type ExportScope,
} from "@/lib/export/customers/constants";

export function ExportCustomersClient() {
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
          <Label htmlFor="scope">导出范围</Label>
          <Select
            id="scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as ExportScope)}
          >
            {EXPORT_SCOPES.map((s) => (
              <option key={s} value={s}>
                {EXPORT_SCOPE_LABELS[s]}
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
            包含敏感字段（phone、wechat_id、email、notes、source_remark）
          </label>
          <p className="mt-1 text-xs text-slate-500">
            取消勾选后，敏感字段将从 CSV 中排除，且无法通过 fields 参数绕过。
          </p>
        </Field>

        <Field>
          <Label>导出字段</Label>
          <p className="text-sm text-slate-600">
            使用默认字段集（{DEFAULT_EXPORT_FIELDS.length} 列，受白名单限制）
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {DEFAULT_EXPORT_FIELDS.join(", ")}
          </p>
        </Field>

        <div>
          <Button onClick={handleExportClick}>导出 CSV</Button>
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
              导出风险确认
            </h3>
            <p className="mt-3 text-sm text-slate-600">
              {EXPORT_RISK_CONFIRMATION_MESSAGE}
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={riskConfirmed}
                onChange={(e) => setRiskConfirmed(e.target.checked)}
                className="mt-0.5 rounded border-slate-300"
              />
              <span>我已阅读并确认上述说明，同意继续导出。</span>
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowRiskDialog(false);
                  setRiskConfirmed(false);
                }}
              >
                取消
              </Button>
              <Button disabled={!riskConfirmed} onClick={doExport}>
                确认导出
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
