"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { AccountLockedModal } from "@/app/(auth)/login/account-locked-modal";
import { LoginPendingModal } from "@/app/(auth)/login/login-pending-modal";
import { UnauthorizedEmailModal } from "@/app/(auth)/login/unauthorized-email-modal";
import { IpEmailRestrictedModal } from "@/app/(auth)/login/ip-email-restricted-modal";
import { LOGIN_BRAND } from "@/app/(auth)/login/login-copy";
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
import { fetchIpEmailRestrictionStatus } from "@/lib/auth/login-ip-restriction-client";
import "./login-page.css";

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
  const [unauthorizedEmailOpen, setUnauthorizedEmailOpen] = useState(false);
  const [ipRestrictedUntil, setIpRestrictedUntil] = useState<string | null>(
    null,
  );
  const processedTimeoutVisitRef = useRef<string | null>(null);

  const reasonParam = searchParams.get("reason");
  const sessionEndParam = searchParams.get("session_end");
  const isTimeoutVisit = isTimeoutLoginReason(reasonParam, sessionEndParam);
  const formDisabled = loading || ipRestrictedUntil != null;

  const closeAccountLockedModal = useCallback(() => {
    setAccountLockedOpen(false);
  }, []);

  const closeUnauthorizedEmailModal = useCallback(() => {
    setUnauthorizedEmailOpen(false);
  }, []);

  const clearIpRestriction = useCallback(() => {
    setIpRestrictedUntil(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const status = await fetchIpEmailRestrictionStatus();
      if (cancelled || !status?.restricted || !status.restrictedUntil) {
        return;
      }
      setIpRestrictedUntil(status.restrictedUntil);
    })();

    return () => {
      cancelled = true;
    };
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
    if (formDisabled) {
      return;
    }

    setLoading(true);
    setError("");

    let keepPendingModal = false;

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
        restrictedUntil?: string;
        remainingSeconds?: number;
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
          keepPendingModal = true;
          redirectToAccessLogout();
          return;
        }
        if (data.errorCode === "IP_EMAIL_RESTRICTED" && data.restrictedUntil) {
          setError("");
          setIpRestrictedUntil(data.restrictedUntil);
          return;
        }
        if (data.errorCode === "UNAUTHORIZED_EMAIL") {
          setError("");
          setUnauthorizedEmailOpen(true);
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
      keepPendingModal = true;
      router.push(redirect);
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      if (!keepPendingModal) {
        setLoading(false);
      }
    }
  }

  return (
    <div className="login-page">
      <div className="login-page__scene" aria-hidden="true">
        <div className="login-page__blush login-page__blush--top" />
        <div className="login-page__blush login-page__blush--bottom" />
      </div>

      <div className="login-page__locale">
        <LanguageSwitcher />
      </div>

      <div className="login-page__stack">
        <Card className="login-page__card p-5" padding>
          <div className="login-page__form-header">
            <p className="login-page__card-brand">{LOGIN_BRAND.name}</p>
            <h1 className="login-page__form-title">{t("auth.signInTitle")}</h1>
            <p className="login-page__form-subtitle">{t("auth.signInSubtitle")}</p>
          </div>

          <form onSubmit={handleSubmit}>
            <fieldset disabled={formDisabled} className="min-w-0 border-0 p-0">
              <Field>
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@company.com"
                  className="login-page__input"
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
                  className="login-page__input"
                />
              </Field>

              {passwordChangedNotice && (
                <p className="login-page__notice alert-success">
                  {passwordChangedNotice}
                </p>
              )}

              {sessionEndNotice && (
                <div className="login-page__notice alert-warning">
                  <p>{sessionEndNotice}</p>
                  {isTimeoutVisit && (
                    <p className="login-page__notice-hint">
                      {t("security.timeoutReverifyHint")}
                    </p>
                  )}
                </div>
              )}

              {error && <p className="login-page__error">{error}</p>}

              <Button
                type="submit"
                className="login-page__submit w-full"
                disabled={formDisabled}
              >
                {loading ? t("auth.signingIn") : t("auth.signIn")}
              </Button>
            </fieldset>
          </form>
        </Card>
      </div>

      <LoginPendingModal open={loading} />
      <UnauthorizedEmailModal
        open={unauthorizedEmailOpen}
        onClose={closeUnauthorizedEmailModal}
      />
      {ipRestrictedUntil && (
        <IpEmailRestrictedModal
          open
          restrictedUntil={ipRestrictedUntil}
          onExpired={clearIpRestriction}
        />
      )}
      <AccountLockedModal
        open={accountLockedOpen}
        onClose={closeAccountLockedModal}
      />
    </div>
  );
}
