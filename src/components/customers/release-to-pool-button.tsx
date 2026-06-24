"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Field } from "@/components/ui/form";

export function ReleaseToPoolButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRelease() {
    if (!confirmed) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/customers/${customerId}/release-to-pool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: { field: string; message: string }[];
      };

      if (res.ok) {
        router.push(`/customers/${customerId}`);
        router.refresh();
        return;
      }

      if (data.fieldErrors?.length) {
        setError(data.fieldErrors.map((e) => e.message).join("；"));
        return;
      }

      setError(data.error ?? "释放失败");
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-amber-500 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
      >
        释放到公共池
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <h3 className="text-lg font-semibold text-slate-900">释放到公共池</h3>
        <p className="mt-2 text-sm text-amber-700">
          确认将该客户释放至公共池吗？此操作不可撤销。
        </p>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4">
          <Field>
            <Label htmlFor="pool-reason">
              释放原因 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="pool-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="请填写释放原因"
            />
          </Field>

          <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1"
            />
            <span>我确认将该客户释放至公共池，此操作不可撤销</span>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setReason("");
              setConfirmed(false);
              setError(null);
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            取消
          </button>
          <Button
            type="button"
            variant="danger"
            disabled={!confirmed || !reason.trim() || submitting}
            onClick={handleRelease}
          >
            {submitting ? "释放中…" : "确认释放"}
          </Button>
        </div>
      </div>
    </div>
  );
}
