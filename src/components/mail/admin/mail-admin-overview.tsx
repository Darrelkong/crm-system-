"use client";

import { Badge, Card } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";
import { listEnabledMailAdminCapabilityKeys } from "@/lib/mail/mail-session-context";
import {
  MAIL_NOTIFICATION_SENDING_DOMAIN,
  MAIL_NOTIFICATION_SENDING_FROM_ADDRESS,
  MAIL_NOTIFICATION_SENDING_FROM_DISPLAY_NAME,
} from "@/lib/mail/notification-sending-domain";
import {
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
  MAIL_ADMIN_SECTION_CLASS,
} from "./mail-admin-states";
import { MailAdminOverviewNotificationIdentityCard } from "./mail-admin-overview-notification-identity-card";

const CAPABILITY_LABEL_KEY: Record<keyof MailAdminCenterCapabilities, string> =
  {
    canAccessMailAdminCenter: "mail.adminCenter.title",
    overview: "mail.adminCenter.sections.overview",
    accessManagement: "mail.adminCenter.sections.access",
    notificationIdentityManagement:
      "mail.adminCenter.sections.notificationIdentity",
    proofDiagnostics: "mail.adminCenter.sections.proofDiagnostics",
    senderIdentityManagement: "mail.adminCenter.sections.senderIdentity",
    signatureTemplateManagement: "mail.adminCenter.sections.signature",
    approvalReviewManagement: "mail.adminCenter.sections.approval",
    approvalWorkflowView: "mail.adminCenter.sections.approval",
    mailboxManagement: "mail.adminCenter.sections.mailbox",
    permissionManagement: "mail.adminCenter.sections.permission",
    deliveryHealth: "mail.adminCenter.sections.deliveryHealth",
  };

function OverviewField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-sm crm-text-secondary">{label}</dt>
      <dd className="text-sm crm-text sm:text-right">{children}</dd>
    </div>
  );
}

function OverviewCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn(className, "p-4 md:p-6")} padding>
      <h3 className="text-sm font-semibold crm-text">{title}</h3>
      {description ? (
        <p className="mt-1 text-sm crm-text-secondary">{description}</p>
      ) : null}
      <div className={description ? "mt-4" : "mt-3"}>{children}</div>
    </Card>
  );
}

export function MailAdminOverview() {
  const { t } = useTranslation();
  const { session, loading, error, refresh, mailAccessEnabled, capabilities } =
    useMailSession();

  if (loading) {
    return (
      <div className={MAIL_ADMIN_SECTION_CLASS}>
        <PageIntro
          compact
          title={t("mail.adminCenter.sections.overview")}
          description={t("mail.adminCenter.descriptions.overview")}
        />
        <MailAdminLoadingState />
      </div>
    );
  }

  if (!session) {
    return (
      <div className={MAIL_ADMIN_SECTION_CLASS}>
        <PageIntro
          compact
          title={t("mail.adminCenter.sections.overview")}
          description={t("mail.adminCenter.descriptions.overview")}
        />
        <MailAdminErrorState
          message={error ?? t("common.networkError")}
          onRetry={() => void refresh()}
        />
      </div>
    );
  }

  const enabledCapabilities = listEnabledMailAdminCapabilityKeys(capabilities);

  return (
    <div className={MAIL_ADMIN_SECTION_CLASS}>
      <PageIntro
        compact
        title={t("mail.adminCenter.sections.overview")}
        description={t("mail.adminCenter.descriptions.overview")}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <OverviewCard title={t("mail.adminCenter.overview.accountTitle")}>
          <dl className="space-y-3">
            <OverviewField label={t("mail.adminCenter.overview.name")}>
              {session.user.name}
            </OverviewField>
            <OverviewField label={t("mail.adminCenter.overview.email")}>
              {session.user.email}
            </OverviewField>
          </dl>
        </OverviewCard>

        <OverviewCard title={t("mail.adminCenter.overview.mailAccessTitle")}>
          <dl className="space-y-3">
            <OverviewField label={t("mail.adminCenter.overview.mailAccess")}>
              <Badge variant={mailAccessEnabled ? "success" : "default"}>
                {mailAccessEnabled
                  ? t("mail.adminCenter.overview.mailAccessEnabled")
                  : t("mail.adminCenter.overview.mailAccessDisabled")}
              </Badge>
            </OverviewField>
          </dl>
        </OverviewCard>

        <OverviewCard
          className="md:col-span-2"
          title={t("mail.adminCenter.overview.capabilitiesTitle")}
          description={t("mail.adminCenter.overview.capabilitiesHint")}
        >
          {enabledCapabilities.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {enabledCapabilities.map((capability) => (
                <li key={capability}>
                  <Badge variant="accent">
                    {t(CAPABILITY_LABEL_KEY[capability])}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <MailAdminEmptyState
              compact
              message={t("mail.adminCenter.overview.noCapabilities")}
            />
          )}
        </OverviewCard>

        <MailAdminOverviewNotificationIdentityCard />

        <OverviewCard
          title={t("mail.adminCenter.overview.sendingDomainTitle")}
          description={t("mail.adminCenter.overview.sendingDomainHint")}
        >
          <dl className="space-y-3">
            <OverviewField label={t("mail.adminCenter.overview.sendingDomain")}>
              <span className="font-mono text-xs sm:text-sm">
                {MAIL_NOTIFICATION_SENDING_DOMAIN}
              </span>
            </OverviewField>
            <OverviewField label={t("mail.adminCenter.overview.sendingDomainStatus")}>
              <Badge variant="success">
                {t("mail.adminCenter.overview.sendingDomainConfigured")}
              </Badge>
            </OverviewField>
            <OverviewField label={t("mail.adminCenter.overview.sendingFromAddress")}>
              <span className="font-mono text-xs sm:text-sm">
                {MAIL_NOTIFICATION_SENDING_FROM_ADDRESS}
              </span>
            </OverviewField>
            <OverviewField label={t("mail.adminCenter.overview.sendingFromDisplayName")}>
              {MAIL_NOTIFICATION_SENDING_FROM_DISPLAY_NAME}
            </OverviewField>
          </dl>
        </OverviewCard>
      </div>
    </div>
  );
}
