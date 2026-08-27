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
  MailAdminDefinitionRow,
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
    approvalReviewManagement: "mail.adminCenter.sections.approvalReview",
    approvalWorkflowView: "mail.adminCenter.sections.approval",
    mailboxManagement: "mail.adminCenter.sections.mailbox",
    permissionManagement: "mail.adminCenter.sections.permission",
    deliveryHealth: "mail.adminCenter.sections.deliveryHealth",
  };

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
    <Card className={cn("p-4 md:p-5", className)} padding>
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
  const {
    session,
    loading,
    error,
    refresh,
    effectiveMailAccessEnabled,
    isCrmRootAdmin,
    capabilities,
  } = useMailSession();

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

  const enabledCapabilityKeys = listEnabledMailAdminCapabilityKeys(capabilities);
  const enabledCapabilities = enabledCapabilityKeys.filter((capability, index) => {
    const labelKey = CAPABILITY_LABEL_KEY[capability];
    const firstIndex = enabledCapabilityKeys.findIndex(
      (candidate) => CAPABILITY_LABEL_KEY[candidate] === labelKey,
    );
    return firstIndex === index;
  });

  const mailAccessLabel =
    isCrmRootAdmin && effectiveMailAccessEnabled
      ? t("mail.adminCenter.overview.mailAccessSystem")
      : effectiveMailAccessEnabled
        ? t("mail.adminCenter.overview.mailAccessEnabled")
        : t("mail.adminCenter.overview.mailAccessDisabled");
  const mailAccessVariant = effectiveMailAccessEnabled ? "success" : "default";

  return (
    <div className={MAIL_ADMIN_SECTION_CLASS}>
      <PageIntro
        compact
        title={t("mail.adminCenter.sections.overview")}
        description={t("mail.adminCenter.descriptions.overview")}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <OverviewCard title={t("mail.adminCenter.overview.accountTitle")}>
          <dl className="space-y-3">
            <MailAdminDefinitionRow label={t("mail.adminCenter.overview.name")}>
              {session.user.name}
            </MailAdminDefinitionRow>
            <MailAdminDefinitionRow
              label={t("mail.adminCenter.overview.email")}
              mono
            >
              {session.user.email}
            </MailAdminDefinitionRow>
            {isCrmRootAdmin ? (
              <MailAdminDefinitionRow label={t("mail.adminCenter.overview.role")}>
                {t("mail.adminCenter.overview.rootAdminRole")}
              </MailAdminDefinitionRow>
            ) : null}
          </dl>
        </OverviewCard>

        <OverviewCard title={t("mail.adminCenter.overview.mailAccessTitle")}>
          <dl className="space-y-3">
            <MailAdminDefinitionRow label={t("mail.adminCenter.overview.mailAccess")}>
              <Badge variant={mailAccessVariant}>{mailAccessLabel}</Badge>
            </MailAdminDefinitionRow>
          </dl>
        </OverviewCard>

        <OverviewCard
          className="lg:col-span-2"
          title={t("mail.adminCenter.overview.capabilitiesTitle")}
          description={t("mail.adminCenter.overview.capabilitiesHint")}
        >
          {enabledCapabilities.length > 0 ? (
            <ul className="mail-admin-capability-list">
              {enabledCapabilities.map((capability) => (
                <li key={capability} className="mail-admin-capability-item">
                  <span className="mail-admin-capability-dot" aria-hidden />
                  <span className="min-w-0">{t(CAPABILITY_LABEL_KEY[capability])}</span>
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
            <MailAdminDefinitionRow
              label={t("mail.adminCenter.overview.sendingDomain")}
              mono
            >
              {MAIL_NOTIFICATION_SENDING_DOMAIN}
            </MailAdminDefinitionRow>
            <MailAdminDefinitionRow
              label={t("mail.adminCenter.overview.sendingDomainStatus")}
            >
              <Badge variant="success">
                {t("mail.adminCenter.overview.sendingDomainConfigured")}
              </Badge>
            </MailAdminDefinitionRow>
            <MailAdminDefinitionRow
              label={t("mail.adminCenter.overview.sendingFromAddress")}
              mono
            >
              {MAIL_NOTIFICATION_SENDING_FROM_ADDRESS}
            </MailAdminDefinitionRow>
            <MailAdminDefinitionRow
              label={t("mail.adminCenter.overview.sendingFromDisplayName")}
            >
              {MAIL_NOTIFICATION_SENDING_FROM_DISPLAY_NAME}
            </MailAdminDefinitionRow>
          </dl>
        </OverviewCard>
      </div>
    </div>
  );
}
