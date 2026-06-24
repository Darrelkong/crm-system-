"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, Select, Label, Field } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { FOLLOW_UP_CHANNELS, FOLLOW_UP_CHANNEL_LABELS } from "@/lib/constants/follow-up-channels";
import { FOLLOW_UP_OUTCOMES, FOLLOW_UP_OUTCOME_LABELS } from "@/lib/constants/follow-up-outcomes";
import type { FollowUpChannel } from "@/lib/constants/follow-up-channels";
import type { FollowUpOutcome } from "@/lib/constants/follow-up-outcomes";
import type { ValidationFieldError } from "@/lib/follow-ups/validation";

export function NewFollowUpForm({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const [form, setForm] = useState({
    channel: "" as FollowUpChannel | "",
    outcome: "" as FollowUpOutcome | "",
    summary: "",
    customerIntent: "",
    nextFollowUpAt: "",
    nextAction: "",
  });

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setServerError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setServerError(null);

    try {
      const res = await fetch(`/api/customers/${customerId}/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: form.channel,
          outcome: form.outcome,
          summary: form.summary,
          customerIntent: form.customerIntent || null,
          nextFollowUpAt: form.nextFollowUpAt
            ? new Date(form.nextFollowUpAt).toISOString()
            : null,
          nextAction: form.nextAction || null,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: ValidationFieldError[];
      };

      if (res.ok) {
        router.push(`/customers/${customerId}`);
        return;
      }

      if (res.status === 400 && data.fieldErrors) {
        const errs: Record<string, string> = {};
        for (const fe of data.fieldErrors) errs[fe.field] = fe.message;
        setFieldErrors(errs);
        return;
      }

      setServerError(data.error ?? "保存失败，请稍后重试");
    } catch {
      setServerError("网络错误，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-2xl">
      <p className="mb-4 text-sm text-slate-600">
        为客户 <span className="font-medium text-slate-900">{customerName}</span> 添加跟进记录
      </p>

      {serverError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {serverError}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <Field>
          <Label htmlFor="channel">
            跟进渠道 <span className="text-red-500">*</span>
          </Label>
          <Select
            id="channel"
            value={form.channel}
            onChange={(e) => set("channel", e.target.value)}
          >
            <option value="">请选择渠道</option>
            {FOLLOW_UP_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {FOLLOW_UP_CHANNEL_LABELS[c]}
              </option>
            ))}
          </Select>
          {fieldErrors.channel && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.channel}</p>
          )}
        </Field>

        <Field>
          <Label htmlFor="outcome">
            跟进结果 <span className="text-red-500">*</span>
          </Label>
          <Select
            id="outcome"
            value={form.outcome}
            onChange={(e) => set("outcome", e.target.value)}
          >
            <option value="">请选择结果</option>
            {FOLLOW_UP_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {FOLLOW_UP_OUTCOME_LABELS[o]}
              </option>
            ))}
          </Select>
          {fieldErrors.outcome && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.outcome}</p>
          )}
        </Field>

        <Field>
          <Label htmlFor="summary">
            跟进内容摘要 <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id="summary"
            rows={4}
            value={form.summary}
            onChange={(e) => set("summary", e.target.value)}
            placeholder="请描述本次跟进情况"
          />
          {fieldErrors.summary && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.summary}</p>
          )}
        </Field>

        <Field>
          <Label htmlFor="customerIntent">客户意向</Label>
          <Input
            id="customerIntent"
            value={form.customerIntent}
            onChange={(e) => set("customerIntent", e.target.value)}
            placeholder="可选"
          />
        </Field>

        <Field>
          <Label htmlFor="nextFollowUpAt">下次跟进时间</Label>
          <Input
            id="nextFollowUpAt"
            type="datetime-local"
            value={form.nextFollowUpAt}
            onChange={(e) => set("nextFollowUpAt", e.target.value)}
          />
          {fieldErrors.nextFollowUpAt && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.nextFollowUpAt}</p>
          )}
          <p className="mt-1 text-xs text-slate-500">填写后将自动创建跟进任务</p>
        </Field>

        <Field>
          <Label htmlFor="nextAction">下一步行动</Label>
          <Input
            id="nextAction"
            value={form.nextAction}
            onChange={(e) => set("nextAction", e.target.value)}
            placeholder="可选"
          />
        </Field>
      </div>

      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "保存中…" : "保存跟进"}
        </Button>
        <a
          href={`/customers/${customerId}`}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          取消
        </a>
      </div>
    </form>
  );
}
