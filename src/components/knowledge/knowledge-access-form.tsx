"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";

export function KnowledgeAccessForm({
  setup = false,
}: {
  setup?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unlockSuccess, setUnlockSuccess] = useState(false);
  useEffect(() => {
    if (!setup) {
      router.prefetch("/knowledge");
    }
  }, [router, setup]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || unlockSuccess) return;
    setError("");
    setBusy(true);
    try {
      const response = await fetch(
        setup ? "/api/knowledge/setup" : "/api/knowledge/access",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            setup
              ? { password, confirmPassword }
              : { password },
          ),
        },
      );
      const data = (await response.json()) as {
        error?: string;
        errorCode?: string;
        redirect?: string;
      };
      if (!response.ok) {
        setBusy(false);
        setError(resolveKnowledgeApiError(t, data, "knowledge.requestFailed"));
        return;
      }
      setUnlockSuccess(true);
      const target = data.redirect ?? "/knowledge";
      startTransition(() => {
        router.replace(target);
      });
    } catch {
      setBusy(false);
      setError(t("knowledge.requestFailed"));
    }
  }

  if (unlockSuccess) {
    return (
      <div
        className="max-w-md space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
        role="status"
        aria-live="polite"
        data-knowledge-unlock-success="true"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-900">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("knowledge.unlockTransition")}
        </div>
        <p className="text-xs text-emerald-800">{t("knowledge.helper")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md">
      <div className="mb-5">
        <Label htmlFor="knowledge-password">
          {t("knowledge.passwordLabel")}
        </Label>
        <Input
          id="knowledge-password"
          type="password"
          autoComplete={setup ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          disabled={busy || isPending}
        />
      </div>
      {setup ? (
        <div className="mb-5">
          <Label htmlFor="knowledge-confirm-password">
            {t("knowledge.confirmPasswordLabel")}
          </Label>
          <Input
            id="knowledge-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            disabled={busy || isPending}
          />
        </div>
      ) : null}
      {error ? (
        <p className="mb-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {!setup ? (
        <p className="mb-4 text-xs crm-text-muted">{t("knowledge.helper")}</p>
      ) : null}
      <Button type="submit" disabled={busy || isPending}>
        {busy || isPending
          ? t("knowledge.processing")
          : setup
            ? t("knowledge.setupSubmit")
            : t("knowledge.accessSubmit")}
      </Button>
    </form>
  );
}
