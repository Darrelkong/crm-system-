"use client";

import { useEffect, useId, useState } from "react";
import { isSafeSuggestedMessageAvailable } from "@/lib/ai/customer-insights/safe-suggested-message";
import { buildSuggestedMessageResetKey } from "@/components/customers/phase2-panel-display";
import { ui } from "@/lib/ui/classes";

const cd = ui.customerDetail;

type TFn = (key: string, params?: Record<string, string>) => string;

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    if (typeof document === "undefined") return false;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function AiInsightSuggestedMessage({
  t,
  customerId,
  insightId,
  generatedAt,
  sourceMessage,
}: {
  t: TFn;
  customerId: string;
  insightId: string;
  generatedAt: string;
  sourceMessage: string;
}) {
  const labelId = useId();
  const available = isSafeSuggestedMessageAvailable(sourceMessage);
  const resetKey = buildSuggestedMessageResetKey({
    customerId,
    insightId,
    generatedAt,
    sourceMessage,
  });
  const [draft, setDraft] = useState(sourceMessage);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setDraft(sourceMessage);
    setStatus(null);
  }, [resetKey, sourceMessage]);

  if (!available) {
    return (
      <div className="customer-detail-callout min-w-0 p-3">
        <h4 className="customer-detail-callout-title">
          {t("customers.phase2.suggestedMessageTitle")}
        </h4>
        <p className={`mt-2 text-sm ${cd.value}`}>
          {t("customers.phase2.safeMessageUnavailable")}
        </p>
      </div>
    );
  }

  const canCopy = draft.trim().length > 0;

  return (
    <div className="customer-detail-callout min-w-0 p-3">
      <h4 id={labelId} className="customer-detail-callout-title">
        {t("customers.phase2.suggestedMessageTitle")}
      </h4>
      <p className={`mt-1 text-xs ${cd.muted}`}>
        {t("customers.phase2.suggestedMessageHint")}
      </p>
      <textarea
        aria-labelledby={labelId}
        className="mt-2 min-h-28 w-full min-w-0 rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setStatus(null);
        }}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="customer-detail-action-btn px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("customers.phase2.copyMessage")}
          disabled={!canCopy}
          onClick={() => {
            if (!canCopy) return;
            void (async () => {
              const ok = await copyTextToClipboard(draft);
              setStatus(
                ok
                  ? t("customers.phase2.copiedConfirmation")
                  : t("customers.phase2.clipboardFailure"),
              );
            })();
          }}
        >
          {t("customers.phase2.copyMessage")}
        </button>
        <button
          type="button"
          className="customer-detail-action-btn px-3 py-1.5"
          aria-label={t("customers.phase2.restoreSuggestion")}
          onClick={() => {
            setDraft(sourceMessage);
            setStatus(null);
          }}
        >
          {t("customers.phase2.restoreSuggestion")}
        </button>
      </div>
      {status && (
        <p className={`mt-2 text-sm ${cd.muted}`} role="status" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  );
}
