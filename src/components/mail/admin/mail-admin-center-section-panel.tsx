"use client";

import { EmptyState } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import type { MailSessionContext } from "@/lib/mail/mail-session-context";
import type { MailAdminCenterSectionId } from "@/lib/mail/mail-session-context";
import { MailAdminOverview } from "./mail-admin-overview";
import { MailAccessManagement } from "./mail-access-management";
import { NotificationIdentityManagement } from "./notification-identity-management";
import { MailboxManagement } from "./mailbox-management";
import { ProofDiagnostics } from "./proof-diagnostics";
import { SenderIdentityManagement } from "./sender-identity-management";
import { SignatureManagement } from "./signature-management";
import { ApprovalWorkflowManagement } from "./approval-workflow-management";
import { SharedMailboxManagement } from "./shared-mailbox-management";

const SECTION_TITLE_KEY: Record<MailAdminCenterSectionId, string> = {
  overview: "mail.adminCenter.sections.overview",
  access: "mail.adminCenter.sections.access",
  notificationIdentity: "mail.adminCenter.sections.notificationIdentity",
  proofDiagnostics: "mail.adminCenter.sections.proofDiagnostics",
  senderIdentity: "mail.adminCenter.sections.senderIdentity",
  signature: "mail.adminCenter.sections.signature",
  approval: "mail.adminCenter.sections.approval",
  mailbox: "mail.adminCenter.sections.mailbox",
  sharedMailbox: "mail.adminCenter.sections.sharedMailbox",
  permission: "mail.adminCenter.sections.permission",
  deliveryHealth: "mail.adminCenter.sections.deliveryHealth",
};

const SECTION_DESC_KEY: Record<MailAdminCenterSectionId, string> = {
  overview: "mail.adminCenter.descriptions.overview",
  access: "mail.adminCenter.descriptions.access",
  notificationIdentity: "mail.adminCenter.descriptions.notificationIdentity",
  proofDiagnostics: "mail.adminCenter.descriptions.proofDiagnostics",
  senderIdentity: "mail.adminCenter.descriptions.senderIdentity",
  signature: "mail.adminCenter.descriptions.signature",
  approval: "mail.adminCenter.descriptions.approval",
  mailbox: "mail.adminCenter.descriptions.mailbox",
  sharedMailbox: "mail.adminCenter.descriptions.sharedMailbox",
  permission: "mail.adminCenter.descriptions.permission",
  deliveryHealth: "mail.adminCenter.descriptions.deliveryHealth",
};

const PLACEHOLDER_SECTIONS = new Set<MailAdminCenterSectionId>([
  "permission",
  "deliveryHealth",
]);

export function MailAdminCenterSectionPanel({
  section,
  session: _session,
}: {
  section: MailAdminCenterSectionId;
  session: MailSessionContext;
}) {
  const { t } = useTranslation();

  if (section === "overview") {
    return <MailAdminOverview />;
  }

  if (section === "access") {
    return <MailAccessManagement />;
  }

  if (section === "notificationIdentity") {
    return <NotificationIdentityManagement />;
  }

  if (section === "proofDiagnostics") {
    return <ProofDiagnostics />;
  }

  if (section === "senderIdentity") {
    return <SenderIdentityManagement />;
  }

  if (section === "signature") {
    return <SignatureManagement />;
  }

  if (section === "approval") {
    return <ApprovalWorkflowManagement />;
  }

  if (section === "mailbox") {
    return <MailboxManagement />;
  }

  if (section === "sharedMailbox") {
    return <SharedMailboxManagement />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold crm-text">
          {t(SECTION_TITLE_KEY[section])}
        </h3>
        <p className="mt-1 text-sm crm-text-secondary">
          {t(SECTION_DESC_KEY[section])}
        </p>
      </div>
      {PLACEHOLDER_SECTIONS.has(section) ? (
        <EmptyState message={t("mail.adminCenter.sectionComingSoon")} />
      ) : null}
    </div>
  );
}
