"use client";

import { useCallback, useState } from "react";
import { Input } from "@/components/ui/form";
import { useIdleExempt } from "@/components/auth/idle-exempt-context";
import { parseActivateResponse } from "@/lib/auth/idle-exempt-ui";

type ModalPhase =
  | "idle"
  | "submitting"
  | "success"
  | "disabled"
  | "error";

function ModalShieldIcon() {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="h-16 w-16"
    >
      <defs>
        <linearGradient
          id="idleExemptShieldGlass"
          x1="32"
          y1="10"
          x2="32"
          y2="52"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.62" />
          <stop offset="42%" stopColor="#6ee7b7" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.22" />
        </linearGradient>
        <linearGradient
          id="idleExemptShieldRim"
          x1="32"
          y1="8"
          x2="32"
          y2="54"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#a7f3d0" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient
          id="idleExemptShieldCheck"
          x1="24"
          y1="28"
          x2="40"
          y2="42"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#bbf7d0" />
        </linearGradient>
        <filter
          id="idleExemptShieldSoftGlow"
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
        >
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path
        d="M32 9.5 51.5 17.2V31.8c0 10.8-12.2 18.8-19.5 22.5-7.3-3.7-19.5-11.7-19.5-22.5V17.2L32 9.5Z"
        fill="#10b981"
        fillOpacity="0.14"
        filter="url(#idleExemptShieldSoftGlow)"
      />

      <path
        d="M32 11 48.5 17.8V31.5c0 9.2-10.4 16.2-16.5 19.4-6.1-3.2-16.5-10.2-16.5-19.4V17.8L32 11Z"
        fill="url(#idleExemptShieldGlass)"
        stroke="url(#idleExemptShieldRim)"
        strokeWidth="1.35"
      />

      <path
        d="M32 14.5 44.8 20.2V30.2c0 6.8-7.6 12-12.8 14.4-5.2-2.4-12.8-7.6-12.8-14.4V20.2L32 14.5Z"
        fill="#ffffff"
        fillOpacity="0.1"
      />

      <ellipse
        cx="32"
        cy="22.5"
        rx="9.5"
        ry="4.5"
        fill="#ffffff"
        fillOpacity="0.26"
      />

      <path
        d="M24.5 31.5 29.2 36.2 40.5 25.2"
        stroke="#047857"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.35"
        transform="translate(0 1.2)"
      />
      <path
        d="M24.5 31.5 29.2 36.2 40.5 25.2"
        stroke="url(#idleExemptShieldCheck)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const closeButtonClass =
  "flex-1 rounded-xl border border-white/20 bg-white/15 px-4 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-60";

const confirmButtonClass =
  "flex-1 rounded-xl border border-white/25 bg-white/90 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60";

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
      if (e.key === "Enter" && (phase === "idle" || phase === "error")) {
        void handleSubmit();
      }
    },
    [handleSubmit, phase],
  );

  if (!modalOpen) return null;

  const showInputForm =
    phase === "idle" || phase === "submitting" || phase === "error";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      role="presentation"
    >
      <div
        className="relative w-full max-w-[400px] rounded-2xl border border-emerald-100/25 bg-emerald-500/10 px-6 pb-6 pt-8 shadow-xl backdrop-blur-xl"
        role="dialog"
        aria-modal="true"
      >
        {phase === "disabled" ? (
          <>
            <div className="flex flex-col items-center px-2 text-center">
              <ModalShieldIcon />
              <p className="mt-4 text-[15px] font-medium leading-relaxed text-white/95">
                該操作已被限制，請聯絡管理員。
              </p>
            </div>
            <div className="mt-6">
              <button
                type="button"
                className={closeButtonClass}
                onClick={resetAndClose}
              >
                關閉
              </button>
            </div>
          </>
        ) : phase === "success" ? (
          <>
            <div className="flex flex-col items-center px-2 text-center">
              <ModalShieldIcon />
              <p className="mt-4 text-[15px] font-medium text-white/95">
                驗證成功。
              </p>
            </div>
            <div className="mt-6">
              <button
                type="button"
                className={closeButtonClass}
                onClick={resetAndClose}
              >
                關閉
              </button>
            </div>
          </>
        ) : showInputForm ? (
          <>
            <div className="flex flex-col items-center px-2">
              <ModalShieldIcon />
            </div>

            <Input
              type="password"
              autoComplete="off"
              className="mt-5 border border-white/20 bg-white/90 text-[#172033] shadow-none placeholder:text-[#94A3B8] focus:border-white/40 focus:ring-2 focus:ring-white/20"
              placeholder="唉呀，被你發現了:)"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={phase === "submitting"}
            />

            {phase === "error" && errorMessage ? (
              <p className="mt-2.5 text-center text-sm text-rose-200/95">
                {errorMessage}
              </p>
            ) : null}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className={closeButtonClass}
                onClick={resetAndClose}
                disabled={phase === "submitting"}
              >
                關閉
              </button>
              <button
                type="button"
                className={confirmButtonClass}
                onClick={() => void handleSubmit()}
                disabled={phase === "submitting"}
              >
                {phase === "submitting" ? "確認中…" : "確認"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
