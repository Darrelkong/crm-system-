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
      panelClassName="qe-drawer-panel--workspace"
    >
      <MailAdminCenterNavigationProvider navigateToSection={setActiveSection}>
        <div className="mail-admin-center-layout">
          <aside className="mail-admin-center-sidebar">
            <div className="mail-admin-center-sidebar-label">
              <p className="mail-admin-center-sidebar-label-text">
                {t("mail.adminCenter.navLabel")}
              </p>
            </div>
            <MailAdminCenterNav
              capabilities={capabilities}
              activeSection={effectiveSection}
              onSelectSection={setActiveSection}
            />
          </aside>
          <div className="mail-admin-center-content">
            <MailAdminCenterSectionPanel section={effectiveSection} session={session} />
          </div>
        </div>
      </MailAdminCenterNavigationProvider>
    </QuickEntryDrawer>
  );
}
