"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function KnowledgeArticleArchiveButton({
  articleId,
  updatedAt,
}: {
  articleId: string;
  updatedAt: string;
}) {
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
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "归档失败");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "归档失败");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      {confirming ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-950">确认归档此文章？归档后不可再编辑。</p>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="danger" onClick={() => void archive()} disabled={busy}>
              确认归档
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
          归档文章
        </Button>
      )}
    </div>
  );
}
