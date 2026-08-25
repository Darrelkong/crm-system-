"use client";

import { useEffect, useRef, useState } from "react";
import { QuickEntryDrawer } from "@/components/ui/quick-entry-drawer";
import { useTranslation } from "@/i18n/provider";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import type { MailAdminCenterSectionId } from "@/lib/mail/mail-session-context";
import { resolveDefaultMailAdminCenterSection } from "@/lib/mail/mail-session-context";
import { MailAdminCenterNavigationProvider } from "@/lib/mail/client/mail-admin-center-navigation";
import { MailAdminCenterNav } from "./mail-admin-center-nav";
import { MailAdminCenterSectionPanel } from "./mail-admin-center-section-panel";

export function MailAdminCenterDrawer({
  open,
  onRequestClose,
  initialSection,
  returnFocusRef,
}: {
  open: boolean;
  onRequestClose: () => void;
  initialSection?: MailAdminCenterSectionId | null;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const { session, capabilities, canOpenAdminCenter } = useMailSession();
  const [activeSection, setActiveSection] = useState<MailAdminCenterSectionId | null>(
    null,
  );
  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const fallback = resolveDefaultMailAdminCenterSection(capabilities);
      setActiveSection(initialSection ?? fallback);
    }
    if (!open) {
      setActiveSection(null);
    }
    prevOpenRef.current = open;
  }, [open, initialSection, capabilities]);

  const effectiveSection =
    activeSection ??
    (open ? initialSection ?? resolveDefaultMailAdminCenterSection(capabilities) : null);

  if (!open || !canOpenAdminCenter || !session || !effectiveSection) {
    return null;
  }

  return (
    <QuickEntryDrawer
      open={open}
      title={t("mail.adminCenter.title")}
      description={t("mail.adminCenter.description")}
      onRequestClose={onRequestClose}
      closeLabel={t("common.close")}
      returnFocusRef={returnFocusRef}
    >
      <MailAdminCenterNavigationProvider navigateToSection={setActiveSection}>
        <div className="mail-admin-center-layout -mx-5 -mb-4 -mt-4 flex min-h-[min(75dvh,100%)] min-w-0 flex-col overflow-hidden md:min-h-[32rem] md:flex-row">
          <aside className="mail-admin-center-sidebar shrink-0 border-b crm-border md:w-56 md:border-b-0 md:border-r">
            <div className="hidden border-b crm-border px-4 py-3 md:block">
              <p className="text-xs font-semibold uppercase tracking-wide crm-text-secondary">
                {t("mail.adminCenter.navLabel")}
              </p>
            </div>
            <MailAdminCenterNav
              capabilities={capabilities}
              activeSection={effectiveSection}
              onSelectSection={setActiveSection}
            />
          </aside>
          <div className="mail-admin-center-content min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[var(--color-crm-bg-muted)] p-3 sm:p-4 md:p-6">
            <div className="mail-admin-center-panel mx-auto max-w-5xl rounded-xl border crm-border bg-[var(--color-crm-bg)] p-4 shadow-sm sm:p-5 md:p-6">
              <MailAdminCenterSectionPanel section={effectiveSection} session={session} />
            </div>
          </div>
        </div>
      </MailAdminCenterNavigationProvider>
    </QuickEntryDrawer>
  );
}
