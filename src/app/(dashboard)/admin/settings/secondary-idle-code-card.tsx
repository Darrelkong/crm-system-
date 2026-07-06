"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/form";
import {
  applySecondaryIdleCodeDisableSuccess,
  applySecondaryIdleCodeDismissRevealed,
  applySecondaryIdleCodeGenerateSuccess,
  applySecondaryIdleCodeStatusLoad,
  createInitialSecondaryIdleCodeUiState,
  formatSecondaryIdleCodeGeneratedAt,
  getSecondaryIdleCodeStatusLabel,
  parseSecondaryIdleCodeDisableResponse,
  parseSecondaryIdleCodeGenerateResponse,
  parseSecondaryIdleCodeGetResponse,
  type SecondaryIdleCodeUiState,
} from "@/lib/settings/secondary-idle-code-ui";

export function SecondaryIdleCodeCard() {
  const [uiState, setUiState] = useState<SecondaryIdleCodeUiState>(
    createInitialSecondaryIdleCodeUiState,
  );
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/secondary-idle-code");
      const data = (await res.json()) as unknown;
      if (!res.ok) {
        const record = data as { error?: string };
        setError(record.error ?? "讀取狀態失敗，請稍後再試。");
        return;
      }
      const status = parseSecondaryIdleCodeGetResponse(data);
      if (!status) {
        setError("讀取狀態失敗，請稍後再試。");
        return;
      }
      setUiState((current) => applySecondaryIdleCodeStatusLoad(current, status));
    } catch {
      setError("讀取狀態失敗，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleGenerate() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/secondary-idle-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const data = (await res.json()) as unknown;
      const parsed = parseSecondaryIdleCodeGenerateResponse(data);
      if (!res.ok || "error" in parsed) {
        setError("error" in parsed ? parsed.error : "生成失敗，請稍後再試。");
        return;
      }

      const reloadRes = await fetch("/api/admin/secondary-idle-code");
      const reloadData = (await reloadRes.json()) as unknown;
      const status = parseSecondaryIdleCodeGetResponse(reloadData);
      const generatedAt = status?.generatedAt ?? new Date().toISOString();

      setUiState((current) =>
        applySecondaryIdleCodeGenerateSuccess(
          current,
          parsed.plaintext,
          generatedAt,
        ),
      );
    } catch {
      setError("生成失敗，請稍後再試。");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDisable() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/secondary-idle-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable" }),
      });
      const data = (await res.json()) as unknown;
      const parsed = parseSecondaryIdleCodeDisableResponse(data);
      if (!res.ok || "error" in parsed) {
        setError("error" in parsed ? parsed.error : "停用失敗，請稍後再試。");
        return;
      }
      setUiState(applySecondaryIdleCodeDisableSuccess);
    } catch {
      setError("停用失敗，請稍後再試。");
    } finally {
      setActionLoading(false);
    }
  }

  function handleDismissRevealed() {
    setUiState(applySecondaryIdleCodeDismissRevealed);
  }

  if (loading) {
    return (
      <section className="surface-card p-5 sm:p-6">
        <p className="text-sm text-[#6B7890]">載入中…</p>
      </section>
    );
  }

  return (
    <section className="surface-card p-5 sm:p-6">
      <div className="max-w-3xl">
        <h3 className="text-base font-semibold text-[#172033]">二級密碼管理</h3>
        <p className="mt-2 text-sm leading-relaxed text-[#6B7890]">
          用於生成一次性二級密碼。密碼只會在生成後顯示一次，請妥善記錄。
        </p>
      </div>

      <div className="mt-5 grid max-w-lg gap-4">
        <div>
          <Label>狀態</Label>
          <div className="mt-2">
            <Badge variant={uiState.status.enabled ? "success" : "default"}>
              {getSecondaryIdleCodeStatusLabel(uiState.status.enabled)}
            </Badge>
          </div>
        </div>

        <div>
          <Label>上次生成</Label>
          <p className="mt-1 text-sm text-[#172033]">
            {formatSecondaryIdleCodeGeneratedAt(uiState.status.generatedAt)}
          </p>
        </div>
      </div>

      {uiState.revealedPlaintext ? (
        <div className="mt-5 max-w-lg rounded-xl border border-[#EEF3F8] bg-[#FAFBFD] p-4">
          <p className="text-sm font-semibold text-[#172033]">
            二級密碼：{uiState.revealedPlaintext}
          </p>
          <p className="mt-2 text-sm text-[#6B7890]">
            此密碼只顯示一次，請妥善記錄。
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={handleDismissRevealed}
          >
            已記錄，關閉
          </Button>
        </div>
      ) : null}

      {uiState.disableMessage ? (
        <p className="mt-4 text-sm text-[#6B7890]">{uiState.disableMessage}</p>
      ) : null}

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={handleGenerate}
          disabled={actionLoading}
        >
          {actionLoading ? "處理中…" : "生成 / 刷新二級密碼"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={handleDisable}
          disabled={actionLoading || !uiState.status.enabled}
        >
          停止使用
        </Button>
      </div>
    </section>
  );
}
