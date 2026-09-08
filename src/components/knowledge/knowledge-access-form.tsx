"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";

export function KnowledgeAccessForm({
  setup = false,
}: {
  setup?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        redirect?: string;
      };
      if (!response.ok) {
        setError(data.error ?? t("knowledge.requestFailed"));
        return;
      }
      setPassword("");
      setConfirmPassword("");
      router.replace(data.redirect ?? "/knowledge");
      router.refresh();
    } catch {
      setError(t("knowledge.requestFailed"));
    } finally {
      setBusy(false);
    }
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
      <Button type="submit" disabled={busy}>
        {busy
          ? t("knowledge.processing")
          : setup
            ? t("knowledge.setupSubmit")
            : t("knowledge.accessSubmit")}
      </Button>
    </form>
  );
}
