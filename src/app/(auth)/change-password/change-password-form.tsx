"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/form";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useTranslation } from "@/i18n/provider";
import { resolveFieldError } from "@/i18n/resolve-api-error";
import type { ChangePasswordFieldError } from "@/lib/auth/change-password";

export function ChangePasswordForm() {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);

  function setField(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setServerError("");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setFieldErrors({});
    setServerError("");

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        redirect?: string;
        error?: string;
        fieldErrors?: ChangePasswordFieldError[];
      };

      if (res.ok && data.redirect) {
        window.location.href = data.redirect;
        return;
      }

      if (res.status === 400 && data.fieldErrors) {
        const errs: Record<string, string> = {};
        for (const fe of data.fieldErrors) {
          errs[fe.field] = resolveFieldError(t, {
            field: fe.field,
            message: fe.message,
            code: fe.code,
          });
        }
        setFieldErrors(errs);
        return;
      }

      setServerError(data.error ?? t("errors.saveFailed"));
    } catch {
      setServerError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center bg-slate-100 px-4 py-10">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md p-6">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">
            {t("auth.changePasswordTitle")}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {t("auth.changePasswordSubtitle")}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <Field>
            <Label htmlFor="currentPassword">{t("auth.currentPassword")}</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(e) => setField("currentPassword", e.target.value)}
              required
            />
            {fieldErrors.currentPassword && (
              <p className="mt-1 text-xs text-red-600">
                {fieldErrors.currentPassword}
              </p>
            )}
          </Field>

          <Field>
            <Label htmlFor="newPassword">{t("auth.newPassword")}</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={form.newPassword}
              onChange={(e) => setField("newPassword", e.target.value)}
              required
            />
            {fieldErrors.newPassword && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.newPassword}</p>
            )}
          </Field>

          <Field>
            <Label htmlFor="confirmPassword">{t("auth.confirmNewPassword")}</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(e) => setField("confirmPassword", e.target.value)}
              required
            />
            {fieldErrors.confirmPassword && (
              <p className="mt-1 text-xs text-red-600">
                {fieldErrors.confirmPassword}
              </p>
            )}
          </Field>

          <p className="mb-4 text-xs text-slate-500">{t("auth.passwordPolicyHint")}</p>

          {serverError && (
            <p className="mb-4 text-sm text-red-600">{serverError}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("auth.updatingPassword") : t("auth.updatePassword")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
