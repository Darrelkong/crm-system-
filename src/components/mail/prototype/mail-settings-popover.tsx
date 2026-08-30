"use client";

import { useEffect, useRef, type RefObject, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import {
  resolveMailSettingsMenuSelect,
  type MailSettingsMenuView,
} from "@/lib/mail/client/mail-settings-menu-action";

type SettingsView = "menu" | MailSettingsMenuView;

type MenuItem = {
  id: SettingsView;
  label: string;
  comingSoon?: boolean;
};

function ComingSoonBadge({ label }: { label: string }) {
  return (
    <span className="mail-settings-coming-soon-badge shrink-0">{label}</span>
  );
}

export function MailSettingsPopover({
  open,
  onClose,
  anchorRef,
  showAdminEntry = false,
  showNotificationMailboxEntry = false,
  onOpenAdminCenter,
  onOpenNotificationMailbox,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  showAdminEntry?: boolean;
  showNotificationMailboxEntry?: boolean;
  onOpenAdminCenter?: () => void;
  onOpenNotificationMailbox?: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<SettingsView>("menu");

  useEffect(() => {
    if (!open) {
      setView("menu");
      return;
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const anchorRect = anchorRef.current?.getBoundingClientRect();
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 390;
  const panelWidth = Math.min(320, viewportWidth - 32);
  const left = anchorRect
    ? Math.max(16, Math.min(anchorRect.right - panelWidth, viewportWidth - panelWidth - 16))
    : 16;
  const top = anchorRect ? anchorRect.bottom + 4 : 0;

  const personalItems: MenuItem[] = [
    ...(showNotificationMailboxEntry
      ? [{ id: "notificationMailbox" as const, label: t("mail.notificationMailbox.title") }]
      : []),
    { id: "display", label: t("mail.settings.display"), comingSoon: true },
    { id: "compose", label: t("mail.settings.composePrefs"), comingSoon: true },
    { id: "notifications", label: t("mail.settings.notifications"), comingSoon: true },
    { id: "signature", label: t("mail.settings.signature"), comingSoon: true },
  ];

  const adminItems: MenuItem[] = showAdminEntry
    ? [{ id: "admin", label: t("mail.settings.admin") }]
    : [];

  const allItems = [...personalItems, ...adminItems];
  const activeItem = allItems.find((m) => m.id === view);

  function handleMenuSelect(id: SettingsView) {
    if (id === "menu") return;

    const result = resolveMailSettingsMenuSelect(id, {
      showAdminEntry,
      hasAdminCenterHandler: Boolean(onOpenAdminCenter),
      showNotificationMailboxEntry,
      hasNotificationMailboxHandler: Boolean(onOpenNotificationMailbox),
    });

    if (!result) return;

    if (result.action === "open_admin_center") {
      onOpenAdminCenter!();
      onClose();
      return;
    }

    if (result.action === "open_notification_mailbox") {
      onOpenNotificationMailbox!();
      onClose();
      return;
    }

    setView(result.view);
  }

  function renderMenuButton(item: MenuItem) {
    return (
      <li key={item.id}>
        <button
          type="button"
          onClick={() => handleMenuSelect(item.id)}
          className="mail-settings-menu-item flex w-full min-h-10 items-center justify-between gap-2 px-3 py-2 text-left text-sm"
        >
          <span className="min-w-0 truncate">{item.label}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {item.comingSoon ? (
              <ComingSoonBadge label={t("mail.settings.comingSoon")} />
            ) : null}
            <ChevronRight className="h-4 w-4 shrink-0 opacity-40" aria-hidden />
          </span>
        </button>
      </li>
    );
  }

  return (
    <div className="fixed inset-0 z-50 pointer-events-none" role="presentation">
      <div
        ref={panelRef}
        className="mail-settings-popover pointer-events-auto fixed overflow-hidden rounded-xl border crm-border bg-[var(--color-crm-bg)]"
        style={{ top, left, width: panelWidth }}
        role="dialog"
        aria-label={t("mail.settings.title")}
      >
        {view === "menu" ? (
          <div className="py-1">
            <p className="mail-settings-section-heading px-3 pb-1 pt-2">
              {t("mail.settings.personalSection")}
            </p>
            <ul>{personalItems.map(renderMenuButton)}</ul>
            {adminItems.length > 0 && (
              <>
                <div className="mail-settings-divider my-1 border-t" />
                <p className="mail-settings-section-heading px-3 pb-1 pt-2">
                  {t("mail.settings.administrationSection")}
                </p>
                <ul>{adminItems.map(renderMenuButton)}</ul>
              </>
            )}
          </div>
        ) : (
          <div className="p-3">
            <button
              type="button"
              onClick={() => setView("menu")}
              className="mb-3 text-xs crm-text-secondary hover:crm-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--color-crm-primary)_45%,transparent)]"
            >
              ← {t("mail.settings.back")}
            </button>
            <div className="mail-settings-placeholder-panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium crm-text">{activeItem?.label}</p>
                <ComingSoonBadge label={t("mail.settings.comingSoon")} />
              </div>
              <p className="mt-2 text-sm leading-relaxed crm-text-secondary">
                {t("mail.settings.sectionComingSoonBody")}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
