"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { AccountLockedModal } from "@/app/(auth)/login/account-locked-modal";
import {
  redirectToAccessLogout,
  isLocalDevelopmentClient,
  sessionEndMessageKey,
  type SessionEndReason,
} from "@/lib/auth/client-security";
import {
  clearTimeoutLoginVisits,
  isTimeoutLoginReason,
  recordTimeoutLoginVisit,
  redirectToCloudflareAccessLogout,
  shouldForceAccessLogoutAfterTimeoutVisit,
  TIMEOUT_ACCESS_LOGOUT_VISIT_THRESHOLD,
} from "@/lib/auth/timeout-login-visits";

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
  const [accountLockedOpen, setAccountLockedOpen] = useState(false);
  const processedTimeoutVisitRef = useRef<string | null>(null);

  const reasonParam = searchParams.get("reason");
  const sessionEndParam = searchParams.get("session_end");
  const isTimeoutVisit = isTimeoutLoginReason(reasonParam, sessionEndParam);

  const closeAccountLockedModal = useCallback(() => {
    setAccountLockedOpen(false);
  }, []);

  useEffect(() => {
    if (!isTimeoutVisit) {
      processedTimeoutVisitRef.current = null;
      return;
    }

    const visitMarker = `${reasonParam ?? ""}|${sessionEndParam ?? ""}|${searchParams.toString()}`;
    if (processedTimeoutVisitRef.current === visitMarker) {
      return;
    }
    processedTimeoutVisitRef.current = visitMarker;

    const visitCount = recordTimeoutLoginVisit();
    const isLocalDev = isLocalDevelopmentClient();

    if (shouldForceAccessLogoutAfterTimeoutVisit(visitCount, isLocalDev)) {
      redirectToCloudflareAccessLogout();
      return;
    }

    if (
      isLocalDev &&
      visitCount >= TIMEOUT_ACCESS_LOGOUT_VISIT_THRESHOLD
    ) {
      clearTimeoutLoginVisits();
    }
  }, [isTimeoutVisit, reasonParam, searchParams, sessionEndParam]);

  const sessionEndNotice = useMemo(() => {
    if (isTimeoutVisit) {
      return t("security.sessionTimedOutReLogin");
    }

    const reason = parseSessionEndParam(sessionEndParam);
    if (!reason) {
      return null;
    }
    return t(sessionEndMessageKey(reason));
  }, [isTimeoutVisit, sessionEndParam, t]);

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

    try {
      const form = new FormData(e.currentTarget);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });

      let data: {
        error?: string;
        errorCode?: string;
        redirect?: string;
      } = {};

      try {
        data = (await response.json()) as typeof data;
      } catch {
        setError(t("common.networkError"));
        return;
      }

      if (!response.ok) {
        if (
          data.errorCode === "ACCESS_VERIFICATION_EXPIRED" &&
          !isLocalDevelopmentClient()
        ) {
          setError(t("security.accessExpired"));
          redirectToAccessLogout();
          return;
        }
        if (data.errorCode === "ACCOUNT_LOCKED") {
          setError("");
          setAccountLockedOpen(true);
          return;
        }
        setError(resolveApiError(t, data));
        return;
      }

      clearTimeoutLoginVisits();

      const redirect =
        data.redirect ?? searchParams.get("redirect") ?? "/";
      router.push(redirect);
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
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
            <p className="alert-success mb-4 px-3 py-2 text-sm">
              {passwordChangedNotice}
            </p>
          )}

          {sessionEndNotice && (
            <div className="alert-warning mb-4 px-3 py-2 text-sm">
              <p>{sessionEndNotice}</p>
              {isTimeoutVisit && (
                <p className="mt-2 text-xs leading-relaxed text-[#6B7890]">
                  {t("security.timeoutReverifyHint")}
                </p>
              )}
            </div>
          )}

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("auth.signingIn") : t("auth.signIn")}
          </Button>
        </form>
      </Card>
      <AccountLockedModal
        open={accountLockedOpen}
        onClose={closeAccountLockedModal}
      />
    </div>
  );
}
