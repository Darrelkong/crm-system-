"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { MailAdminCenterDrawer } from "@/components/mail/admin/mail-admin-center-drawer";
import { MailDebugControls } from "./mail-debug-controls";

type MailAdminOnlyShellProps = {
  onOpenAdminCenter?: () => void;
  adminCenterOpen?: boolean;
  onAdminCenterOpenChange?: (open: boolean) => void;
};

export function MailAdminOnlyShell({
  onOpenAdminCenter,
  adminCenterOpen: controlledOpen,
  onAdminCenterOpenChange,
}: MailAdminOnlyShellProps) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const adminCenterOpen = controlledOpen ?? internalOpen;

  function setAdminCenterOpen(open: boolean) {
    onAdminCenterOpenChange?.(open);
    if (controlledOpen === undefined) {
      setInternalOpen(open);
    }
  }

  function openAdminCenter() {
    onOpenAdminCenter?.();
    setAdminCenterOpen(true);
  }

  return (
    <div className="mail-prototype-root flex min-h-[calc(100dvh-4.5rem)] min-w-0 flex-col">
      <div className="flex items-center justify-end border-b border-border/60 px-4 py-2 sm:px-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={openAdminCenter}
        >
          <Settings className="h-4 w-4" />
          {t("mail.adminOnlyShell.settings")}
        </Button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <h2 className="text-lg font-semibold crm-text">
          {t("mail.adminOnlyShell.title")}
        </h2>
        <p className="mt-2 max-w-md text-sm crm-text-secondary">
          {t("mail.adminOnlyShell.description")}
        </p>
        <Button
          type="button"
          variant="secondary"
          className="mt-6"
          onClick={openAdminCenter}
        >
          {t("mail.adminOnlyShell.openAdminCenter")}
        </Button>
      </div>

      <MailAdminCenterDrawer
        open={adminCenterOpen}
        onRequestClose={() => setAdminCenterOpen(false)}
      />
      <MailDebugControls />
    </div>
  );
}
