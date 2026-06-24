"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/form";
import {
  DEFAULT_EXPORT_FIELDS,
  EXPORT_SCOPE_LABELS,
  EXPORT_SCOPES,
  type ExportScope,
} from "@/lib/export/customers/constants";

export function ExportCustomersClient() {
  const [scope, setScope] = useState<ExportScope>("all_active");
  const [includeSensitive, setIncludeSensitive] = useState(true);

  function handleExport() {
    const params = new URLSearchParams({
      scope,
      includeSensitive: String(includeSensitive),
      fields: DEFAULT_EXPORT_FIELDS.join(","),
    });
    window.location.href = `/api/export/customers?${params}`;
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
            包含敏感字段（phone、wechat_id、email、source_remark）
          </label>
          <p className="mt-1 text-xs text-slate-500">
            取消勾选后，敏感字段将从 CSV 中排除。
          </p>
        </Field>

        <Field>
          <Label>导出字段</Label>
          <p className="text-sm text-slate-600">
            使用默认字段集（{DEFAULT_EXPORT_FIELDS.length} 列）
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {DEFAULT_EXPORT_FIELDS.join(", ")}
          </p>
        </Field>

        <div>
          <Button onClick={handleExport}>导出 CSV</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1">{children}</div>;
}
