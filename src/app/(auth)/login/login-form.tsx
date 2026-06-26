"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import {
  redirectToAccessLogout,
  isLocalDevelopmentClient,
  sessionEndMessageKey,
  type SessionEndReason,
} from "@/lib/auth/client-security";

function parseSessionEndParam(value: string | null): SessionEndReason | null {
  if (value === "idle" || value === "revoked" || value === "invalid") {
    return value;
  }
  return null;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const sessionEndNotice = useMemo(() => {
    const reason = parseSessionEndParam(searchParams.get("session_end"));
    if (!reason) return null;
    return t(sessionEndMessageKey(reason));
  }, [searchParams, t]);

  const passwordChangedNotice = useMemo(() => {
    if (searchParams.get("password_changed") === "1") {
      return t("auth.passwordUpdatedRelogin");
    }
    return null;
  }, [searchParams, t]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });

    const data = (await response.json()) as {
      error?: string;
      errorCode?: string;
      redirect?: string;
    };

    setLoading(false);

    if (!response.ok) {
      if (
        data.errorCode === "ACCESS_VERIFICATION_EXPIRED" &&
        !isLocalDevelopmentClient()
      ) {
        setError(t("security.accessExpired"));
        redirectToAccessLogout();
        return;
      }
      setError(resolveApiError(t, data));
      return;
    }

    const redirect =
      data.redirect ?? searchParams.get("redirect") ?? "/";
    router.push(redirect);
    router.refresh();
  }

  return (
    <div className="auth-shell relative">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="brand-kicker">{t("brand.crmName")}</p>
          <p className="page-description mt-2">{t("brand.portalSubtitle")}</p>
        </div>

        <div className="mb-6 text-center">
          <h1 className="page-title">{t("auth.signInTitle")}</h1>
          <p className="page-description">{t("auth.signInSubtitle")}</p>
        </div>

        <form onSubmit={handleSubmit}>
          <Field>
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="name@company.com"
            />
          </Field>
          <Field>
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </Field>

          {passwordChangedNotice && (
            <p className="alert-success mb-4 px-3 py-2 text-sm">{passwordChangedNotice}</p>
          )}

          {sessionEndNotice && (
            <p className="alert-warning mb-4 px-3 py-2 text-sm">{sessionEndNotice}</p>
          )}

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("auth.signingIn") : t("auth.signIn")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
