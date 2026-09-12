"use client";

import { useState } from "react";
import { Archive } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";

export function KnowledgeSourceArchiveButton({
  sourceId,
  updatedAt,
  onArchived,
}: {
  sourceId: string;
  updatedAt: string;
  onArchived: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/knowledge/sources/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archive: true,
          expectedUpdatedAt: updatedAt,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        errorCode?: string;
      };
      if (!response.ok) {
        throw new Error(
          resolveKnowledgeApiError(t, payload, "knowledge.ingest.archiveFailed"),
        );
      }
      onArchived();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.ingest.archiveFailed"),
      );
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm crm-text">{t("knowledge.ingest.confirmArchiveMessage")}</p>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => void archive()} disabled={busy}>
            {t("knowledge.ingest.confirmArchive")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            {t("knowledge.ingest.cancelArchive")}
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
      className="border border-amber-200 bg-white text-amber-950 hover:bg-amber-50"
      data-archive-source-button="true"
      onClick={() => setConfirming(true)}
    >
      <Archive className="mr-1.5 h-4 w-4" aria-hidden="true" />
      {t("knowledge.ingest.archiveSource")}
    </Button>
  );
}
