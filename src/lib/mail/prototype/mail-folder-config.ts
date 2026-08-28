import type { MailFolderId } from "./types";

export type MailFolderDef = {
  id: MailFolderId;
  labelKey: string;
  adminOnly?: boolean;
  section: "mail" | "admin";
};

/** Canonical folder list — all surfaces must use this source. */
export const MAIL_FOLDER_DEFS: MailFolderDef[] = [
  { id: "inbox", labelKey: "mail.folders.inbox", section: "mail" },
  { id: "pending", labelKey: "mail.folders.pending", section: "mail" },
  { id: "drafts", labelKey: "mail.folders.drafts", section: "mail" },
  { id: "pending_approval", labelKey: "mail.folders.waitingApproval", section: "mail" },
  { id: "returned", labelKey: "mail.folders.returned", section: "mail" },
  { id: "sent", labelKey: "mail.folders.sent", section: "mail" },
  { id: "trash", labelKey: "mail.folders.trash", section: "mail" },
  {
    id: "pending_my_approval",
    labelKey: "mail.folders.pendingMyApproval",
    adminOnly: true,
    section: "admin",
  },
];

export function visibleMailFolders(isAdmin: boolean): MailFolderDef[] {
  return MAIL_FOLDER_DEFS.filter((f) => !f.adminOnly || isAdmin);
}

export function folderLabelKey(folderId: MailFolderId): string {
  return (
    MAIL_FOLDER_DEFS.find((f) => f.id === folderId)?.labelKey ??
    "mail.folders.inbox"
  );
}
