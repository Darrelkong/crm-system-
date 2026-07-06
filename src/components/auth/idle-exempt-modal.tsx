"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useIdleExempt } from "@/components/auth/idle-exempt-context";
import { parseActivateResponse } from "@/lib/auth/idle-exempt-ui";

type ModalPhase =
  | "idle"       // waiting for input
  | "submitting" // request in flight
  | "success"    // code verified
  | "disabled"   // feature administratively disabled
  | "error";     // wrong code / lockout / network

export function IdleExemptModal() {
  const { modalOpen, closeModal, setExemptUntil } = useIdleExempt();

  const [phase, setPhase] = useState<ModalPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [code, setCode] = useState<string>("");

  const resetAndClose = useCallback(() => {
    setPhase("idle");
    setErrorMessage("");
    setCode("");
    closeModal();
  }, [closeModal]);

  const handleSubmit = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setPhase("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/auth/activate-idle-exempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });

      const data = (await res.json()) as unknown;
      const result = parseActivateResponse(res.status, data);

      if (result.ok) {
        setExemptUntil(result.exemptUntil);
        setPhase("success");
        setCode("");
        return;
      }

      if (result.disabled) {
        setPhase("disabled");
        setCode("");
        return;
      }

      setPhase("error");
      setErrorMessage(result.message);
    } catch {
      setPhase("error");
      setErrorMessage("驗證失敗，請確認後再試。");
    }
  }, [code, setExemptUntil]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && phase === "idle") {
        void handleSubmit();
      }
    },
    [handleSubmit, phase],
  );

  if (!modalOpen) return null;

  return (
    <div className="modal-overlay" onClick={resetAndClose}>
      <div
        className="modal-panel w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Green accent header bar */}
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
            <span className="h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <h2 className="text-base font-semibold text-[#172033] dark:text-white">
            系統驗證
          </h2>
        </div>

        {phase === "disabled" ? (
          <>
            <p className="text-sm leading-relaxed text-[#6B7890]">
              該操作已被限制，請聯絡管理員。
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-5 w-full"
              onClick={resetAndClose}
            >
              關閉視窗
            </Button>
          </>
        ) : phase === "success" ? (
          <>
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              驗證成功。
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-5 w-full"
              onClick={resetAndClose}
            >
              關閉視窗
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-[#6B7890]">
              請輸入隨機生成的二級密碼。
            </p>

            <Input
              type="password"
              autoComplete="off"
              className="mt-4"
              placeholder="••••••••"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={phase === "submitting"}
            />

            {phase === "error" && errorMessage ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                {errorMessage}
              </p>
            ) : null}

            <div className="mt-5 flex gap-3">
              <Button
                type="button"
                size="sm"
                className="flex-1"
                onClick={() => void handleSubmit()}
                disabled={phase === "submitting"}
              >
                {phase === "submitting" ? "驗證中…" : "驗證"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={resetAndClose}
                disabled={phase === "submitting"}
              >
                關閉視窗
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
