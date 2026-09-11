"use client";

import { useState } from "react";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";

export function KnowledgeSourceRestoreButton({
  sourceId,
  updatedAt,
  onRestored,
}: {
  sourceId: string;
  updatedAt: string;
  onRestored: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/knowledge/sources/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restore: true,
          expectedUpdatedAt: updatedAt,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        errorCode?: string;
      };
      if (!response.ok) {
        throw new Error(
          resolveKnowledgeApiError(t, payload, "knowledge.ingest.restoreFailed"),
        );
      }
      onRestored();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.ingest.restoreFailed"),
      );
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div
        className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
        data-source-restore-confirm="true"
      >
        <p className="text-sm crm-text">{t("knowledge.ingest.confirmRestoreMessage")}</p>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void restore()}
            disabled={busy}
            data-source-restore-submit="true"
          >
            {t("knowledge.ingest.confirmRestore")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            {t("knowledge.ingest.cancelRestore")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => setConfirming(true)}
      data-source-restore-action="true"
    >
      {t("knowledge.ingest.restoreSource")}
    </Button>
  );
}
