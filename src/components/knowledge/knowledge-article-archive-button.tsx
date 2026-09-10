"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";

export function KnowledgeArticleArchiveButton({
  articleId,
  updatedAt,
}: {
  articleId: string;
  updatedAt: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/knowledge/articles/${articleId}`, {
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
          resolveKnowledgeApiError(t, payload, "knowledge.article.archiveFailed"),
        );
      }
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.article.archiveFailed"),
      );
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      {confirming ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-950">
            {t("knowledge.article.confirmArchiveMessage")}
          </p>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="danger" onClick={() => void archive()} disabled={busy}>
              {t("knowledge.article.confirmArchive")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              {t("knowledge.article.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
          {t("knowledge.article.archiveArticle")}
        </Button>
      )}
    </div>
  );
}
