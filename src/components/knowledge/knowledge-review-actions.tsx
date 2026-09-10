"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";

type ActiveReview = {
  id: string;
  submittedVersionNumber: number;
  submittedByUserId: string;
  status: "pending";
};

export function KnowledgeReviewActions({
  articleId,
  currentVersionNumber,
  userId,
  canSubmit,
  activeReview,
  hasChangesRequested = false,
}: {
  articleId: string;
  currentVersionNumber: number;
  userId: string;
  canSubmit: boolean;
  activeReview: ActiveReview | null;
  hasChangesRequested?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canSubmit) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/knowledge/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId,
          submissionNote: note,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        errorCode?: string;
      };
      if (!response.ok) {
        throw new Error(
          resolveKnowledgeApiError(
            t,
            payload,
            "knowledge.article.submitReviewFailed",
          ),
        );
      }
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.article.submitReviewFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!activeReview) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/knowledge/review/${activeReview.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw" }),
      });
      const payload = (await response.json()) as {
        error?: string;
        errorCode?: string;
      };
      if (!response.ok) {
        throw new Error(
          resolveKnowledgeApiError(
            t,
            payload,
            "knowledge.article.withdrawReviewFailed",
          ),
        );
      }
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.article.withdrawReviewFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {activeReview ? (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-950">
            {t("knowledge.article.inReviewActive", {
              version: String(activeReview.submittedVersionNumber),
            })}
          </p>
          {activeReview.submittedByUserId === userId && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => void withdraw()}
              disabled={busy}
            >
              {t("knowledge.article.withdrawReview")}
            </Button>
          )}
        </Card>
      ) : open ? (
        <Card className="border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-950">
            {t("knowledge.article.submitCurrentVersion", {
              version: String(currentVersionNumber),
            })}
          </p>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("knowledge.article.submissionNotePlaceholder")}
            rows={3}
            maxLength={2_000}
            className="mt-3 w-full rounded-xl border border-blue-200 bg-white p-3 text-sm"
          />
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void submit()} disabled={busy}>
              {busy
                ? t("knowledge.article.submitting")
                : t("knowledge.article.confirmSubmitReview")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              {t("knowledge.article.cancel")}
            </Button>
          </div>
        </Card>
      ) : (
        <div>
          <Button type="button" onClick={() => setOpen(true)}>
            {hasChangesRequested
              ? t("knowledge.article.resubmitReview")
              : t("knowledge.article.submitReview")}
          </Button>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}
