"use client";

import { useEffect, useRef, type RefObject, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";

type SettingsView = "menu" | "display" | "compose" | "notifications" | "sender" | "admin";

export function MailSettingsPopover({
  open,
  onClose,
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const { isAdminScenario } = useMailPrototype();
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
  const panelWidth = Math.min(300, viewportWidth - 32);
  const left = anchorRect
    ? Math.max(16, Math.min(anchorRect.right - panelWidth, viewportWidth - panelWidth - 16))
    : 16;
  const top = anchorRect ? anchorRect.bottom + 4 : 0;

  const menuItems: {
    id: SettingsView;
    label: string;
    adminOnly?: boolean;
    dividerBefore?: boolean;
  }[] = [
    { id: "display", label: t("mail.settings.display") },
    { id: "compose", label: t("mail.settings.composePrefs") },
    { id: "notifications", label: t("mail.settings.notifications") },
    { id: "sender", label: t("mail.settings.defaultSender") },
    {
      id: "admin",
      label: t("mail.settings.admin"),
      adminOnly: true,
      dividerBefore: true,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 pointer-events-none" role="presentation">
      <div
        ref={panelRef}
        className="mail-settings-popover pointer-events-auto fixed overflow-hidden rounded-md border crm-border bg-[var(--color-crm-bg)] shadow-sm"
        style={{ top, left, width: panelWidth }}
      >
        {view === "menu" ? (
          <ul className="py-1">
            {menuItems
              .filter((item) => !item.adminOnly || isAdminScenario)
              .map((item) => (
                <li key={item.id}>
                  {item.dividerBefore && (
                    <div className="my-1 border-t border-black/[0.06] dark:border-white/[0.08]" />
                  )}
                  <button
                    type="button"
                    onClick={() => setView(item.id)}
                    className="mail-folder-popover-row-idle flex w-full min-h-10 items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                  >
                    <span>{item.label}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
                  </button>
                </li>
              ))}
          </ul>
        ) : (
          <div className="p-3">
            <button
              type="button"
              onClick={() => setView("menu")}
              className="mb-2 text-xs crm-text-secondary hover:crm-text"
            >
              ← {t("mail.settings.back")}
            </button>
            <p className="text-sm font-medium crm-text">
              {view === "admin"
                ? t("mail.settings.admin")
                : menuItems.find((m) => m.id === view)?.label}
            </p>
            <p className="mt-2 text-sm crm-text-secondary">
              {view === "admin"
                ? t("mail.settings.adminPlaceholder")
                : t("mail.settings.sectionPlaceholder")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
