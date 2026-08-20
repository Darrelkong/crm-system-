"use client";

import { cn } from "@/lib/cn";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { visibleMailFolders } from "@/lib/mail/prototype/mail-folder-config";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function MailFolderNav({
  onCompose,
  className,
  showComposeButton = true,
}: {
  onCompose: () => void;
  className?: string;
  showComposeButton?: boolean;
}) {
  const { t } = useTranslation();
  const {
    activeFolder,
    setActiveFolder,
    folderCounts,
    isAdminScenario,
    setSelectedId,
  } = useMailPrototype();

  const folders = visibleMailFolders(isAdminScenario);
  const mailFolders = folders.filter((f) => f.section === "mail");
  const adminFolders = folders.filter((f) => f.section === "admin");

  function FolderButton({
    id,
    labelKey,
  }: {
    id: (typeof folders)[number]["id"];
    labelKey: string;
  }) {
    const count = folderCounts[id];
    const active = activeFolder === id;
    return (
      <button
        type="button"
        onClick={() => {
          setActiveFolder(id);
          setSelectedId(null);
        }}
        className={cn(
          "flex min-h-9 w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
          active ? "mail-nav-active" : "mail-nav-item",
        )}
      >
        <span className="truncate">{t(labelKey)}</span>
        {count > 0 && (
          <span
            className={cn(
              "ml-2 shrink-0 text-xs tabular-nums",
              active ? "opacity-90" : "crm-text-secondary",
            )}
          >
            {count}
          </span>
        )}
      </button>
    );
  }

  return (
    <aside className={cn("flex flex-col gap-3", className)}>
      {showComposeButton && (
        <Button
          type="button"
          size="sm"
          className="h-9 w-full justify-center gap-1.5 shadow-sm"
          onClick={onCompose}
        >
          <Plus className="h-4 w-4" />
          {t("mail.compose.new")}
        </Button>
      )}
      <nav className="space-y-0.5">
        {mailFolders.map((folder) => (
          <FolderButton
            key={folder.id}
            id={folder.id}
            labelKey={folder.labelKey}
          />
        ))}
      </nav>
      {adminFolders.length > 0 && (
        <nav className="space-y-0.5 border-t crm-border pt-2">
          {adminFolders.map((folder) => (
            <FolderButton
              key={folder.id}
              id={folder.id}
              labelKey={folder.labelKey}
            />
          ))}
        </nav>
      )}
    </aside>
  );
}
