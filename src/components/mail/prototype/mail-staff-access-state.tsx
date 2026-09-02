"use client";

import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";
import type { MailEffectiveAccessState } from "@/lib/mail/effective-mail-access-state";

export function MailStaffAccessState({
  state,
  dashboardHref,
  onConfigureNotification,
}: {
  state: MailEffectiveAccessState;
  dashboardHref: "/admin" | "/staff";
  onConfigureNotification?: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const onboarding =
    state === "MAILBOX_ASSIGNED_NOTIFICATION_MISSING" ||
    state === "MAILBOX_ASSIGNED_NOTIFICATION_PENDING";

  if (onboarding) {
    const pending = state === "MAILBOX_ASSIGNED_NOTIFICATION_PENDING";
    return (
      <div className="flex min-h-[calc(100dvh-4.5rem)] flex-col items-center justify-center px-6 py-16 text-center">
        <ShieldCheck className="h-10 w-10 text-primary" aria-hidden="true" />
        <h2 className="mt-5 text-lg font-semibold crm-text">
          {t(
            pending
              ? "mail.onboarding.pendingTitle"
              : "mail.onboarding.title",
          )}
        </h2>
        <p className="mt-2 max-w-md whitespace-pre-line text-sm crm-text-secondary">
          {t(
            pending
              ? "mail.onboarding.pendingDescription"
              : "mail.onboarding.description",
          )}
        </p>
        <Button
          type="button"
          className="mt-6"
          onClick={onConfigureNotification}
        >
          {t(
            pending
              ? "mail.onboarding.continueVerification"
              : "mail.onboarding.configure",
          )}
        </Button>
        {!pending ? (
          <p className="mt-4 max-w-sm text-xs crm-text-secondary">
            {t("mail.onboarding.explanation")}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-4.5rem)] flex-col items-center justify-center px-6 py-16 text-center">
      <h2 className="text-lg font-semibold crm-text">
        {t(
          state === "IDENTITY_SECURITY_REVOKED"
            ? "mail.accessState.identityRevokedTitle"
            : state === "MAILBOX_ARCHIVED"
              ? "mail.accessState.mailboxArchivedTitle"
              : "mail.noAccess.title",
        )}
      </h2>
      <p className="mt-2 max-w-md whitespace-pre-line text-sm crm-text-secondary">
        {t(
          state === "IDENTITY_SECURITY_REVOKED"
            ? "mail.accessState.identityRevokedDescription"
            : state === "MAILBOX_ARCHIVED"
              ? "mail.accessState.mailboxArchivedDescription"
              : "mail.noAccess.description",
        )}
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-6"
        onClick={() => router.push(dashboardHref)}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("mail.noAccess.backToDashboard")}
      </Button>
    </div>
  );
}
