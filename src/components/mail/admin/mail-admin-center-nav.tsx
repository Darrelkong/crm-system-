"use client";

import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import type { MailAdminCenterSectionId } from "@/lib/mail/mail-session-context";
import { getVisibleMailAdminCenterSections } from "@/lib/mail/mail-session-context";
import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";

const SECTION_I18N_KEY: Record<MailAdminCenterSectionId, string> = {
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

export function MailAdminCenterNav({
  capabilities,
  activeSection,
  onSelectSection,
  className,
}: {
  capabilities: MailAdminCenterCapabilities;
  activeSection: MailAdminCenterSectionId;
  onSelectSection: (section: MailAdminCenterSectionId) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const sections = getVisibleMailAdminCenterSections(capabilities);

  return (
    <nav
      className={cn("min-h-0 shrink-0 overflow-y-auto", className)}
      aria-label={t("mail.adminCenter.navLabel")}
    >
      <ul className="flex gap-1 overflow-x-auto p-2 md:block md:space-y-0.5 md:overflow-visible md:p-2">
        {sections.map((section) => {
          const active = section === activeSection;
          return (
            <li key={section} className="shrink-0 md:shrink">
              <button
                type="button"
                onClick={() => onSelectSection(section)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "mail-admin-nav-item whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors md:w-full",
                  active
                    ? "mail-admin-nav-item-active font-medium"
                    : "mail-admin-nav-item-idle crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]",
                )}
              >
                {t(SECTION_I18N_KEY[section])}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
