"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MailAdminCenterSectionId } from "@/lib/mail/mail-session-context";

type MailAdminCenterNavigationContextValue = {
  navigateToSection: (section: MailAdminCenterSectionId) => void;
};

const MailAdminCenterNavigationContext =
  createContext<MailAdminCenterNavigationContextValue | null>(null);

export function MailAdminCenterNavigationProvider({
  navigateToSection,
  children,
}: {
  navigateToSection: (section: MailAdminCenterSectionId) => void;
  children: ReactNode;
}) {
  return (
    <MailAdminCenterNavigationContext.Provider value={{ navigateToSection }}>
      {children}
    </MailAdminCenterNavigationContext.Provider>
  );
}

export function useMailAdminCenterNavigation(): MailAdminCenterNavigationContextValue {
  const value = useContext(MailAdminCenterNavigationContext);
  if (!value) {
    throw new Error(
      "useMailAdminCenterNavigation must be used within MailAdminCenterNavigationProvider",
    );
  }
  return value;
}
