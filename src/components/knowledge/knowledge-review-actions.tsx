"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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
}: {
  articleId: string;
  currentVersionNumber: number;
  userId: string;
  canSubmit: boolean;
  activeReview: ActiveReview | null;
}) {
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
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "提交审核失败");
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交审核失败");
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
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "撤回审核失败");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "撤回审核失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {activeReview ? (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-950">
            此版本正在审核中（Version {activeReview.submittedVersionNumber}）。如需修改，请先撤回审核。
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
              撤回审核
            </Button>
          )}
        </Card>
      ) : open ? (
        <Card className="border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-950">
            提交当前 Version {currentVersionNumber} 审核
          </p>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="提交说明（可选）"
            rows={3}
            maxLength={2_000}
            className="mt-3 w-full rounded-xl border border-blue-200 bg-white p-3 text-sm"
          />
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void submit()} disabled={busy}>
              {busy ? "提交中…" : "确认提交审核"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              取消
            </Button>
          </div>
        </Card>
      ) : (
        <div>
          <Button type="button" onClick={() => setOpen(true)}>
            提交审核
          </Button>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}
