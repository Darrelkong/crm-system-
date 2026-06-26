"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";
import { resolveFieldError } from "@/i18n/resolve-api-error";
import type { ChangePasswordFieldError } from "@/lib/auth/change-password";

export function AccountChangePasswordForm() {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  function setField(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setServerError("");
    setSuccess(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setFieldErrors({});
    setServerError("");
    setSuccess(false);

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
        setSuccess(true);
        window.setTimeout(() => {
          window.location.href = data.redirect!;
        }, 1200);
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

      setServerError(t("errors.saveFailed"));
    } catch {
      setServerError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="surface-card p-4 sm:p-6">
      <h2 className="text-base font-semibold text-[#172033]">
        {t("account.changePassword")}
      </h2>
      <p className="mt-1 text-sm text-[#6B7890]">
        {t("account.changePasswordDescription")}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 max-w-md space-y-4">
        <Field>
          <Label htmlFor="account-currentPassword">{t("auth.currentPassword")}</Label>
          <Input
            id="account-currentPassword"
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(e) => setField("currentPassword", e.target.value)}
            required
            className="min-h-11"
          />
          {fieldErrors.currentPassword && (
            <p className="mt-1 text-xs text-red-600">
              {fieldErrors.currentPassword}
            </p>
          )}
        </Field>

        <Field>
          <Label htmlFor="account-newPassword">{t("auth.newPassword")}</Label>
          <Input
            id="account-newPassword"
            type="password"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={(e) => setField("newPassword", e.target.value)}
            required
            className="min-h-11"
          />
          {fieldErrors.newPassword && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.newPassword}</p>
          )}
        </Field>

        <Field>
          <Label htmlFor="account-confirmPassword">
            {t("auth.confirmNewPassword")}
          </Label>
          <Input
            id="account-confirmPassword"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => setField("confirmPassword", e.target.value)}
            required
            className="min-h-11"
          />
          {fieldErrors.confirmPassword && (
            <p className="mt-1 text-xs text-red-600">
              {fieldErrors.confirmPassword}
            </p>
          )}
        </Field>

        <p className="text-xs text-[#6B7890]">{t("auth.passwordPolicyHint")}</p>

        {success && (
          <p className="alert-success px-3 py-2 text-sm">
            {t("account.passwordChangedSuccess")}
          </p>
        )}

        {serverError && (
          <p className="alert-error px-3 py-2 text-sm">{serverError}</p>
        )}

        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={loading}>
          {loading ? t("auth.updatingPassword") : t("auth.updatePassword")}
        </Button>
      </form>
    </div>
  );
}
