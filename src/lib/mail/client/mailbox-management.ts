import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";
import { MAIL_NOTIFICATION_SENDING_DOMAIN } from "@/lib/mail/notification-sending-domain";
import type { MailAccessAdminUser } from "@/lib/mail/client/mail-access-management";

export type MailboxApiItem = {
  id: string;
  address: string;
  displayName: string | null;
  mailboxType: "personal" | "shared";
  status: "active" | "suspended" | "archived" | "deleted";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MailboxRow = MailboxApiItem & {
  ownerLabel: string;
};

export type MailboxRowActions = {
  showEnable: boolean;
  showDisable: boolean;
};

export function canManageMailboxes(
  capabilities: Pick<MailAdminCenterCapabilities, "mailboxManagement">,
): boolean {
  return capabilities.mailboxManagement;
}

export function isSystemSendingDomainAddress(address: string): boolean {
  return address.trim().toLowerCase().endsWith(`@${MAIL_NOTIFICATION_SENDING_DOMAIN}`);
}

export function filterManageableMailboxes(
  items: MailboxApiItem[],
): MailboxApiItem[] {
  return items.filter(
    (item) =>
      item.status !== "deleted" && !isSystemSendingDomainAddress(item.address),
  );
}

export function resolveMailboxOwnerLabel(
  createdBy: string | null,
  usersById: Map<string, MailAccessAdminUser>,
): string {
  if (!createdBy) {
    return "—";
  }
  const user = usersById.get(createdBy);
  if (!user) {
    return createdBy;
  }
  return user.name || user.email;
}

export function buildMailboxRows(
  items: MailboxApiItem[],
  users: MailAccessAdminUser[],
): MailboxRow[] {
  const usersById = new Map(users.map((user) => [user.id, user] as const));
  return filterManageableMailboxes(items)
    .map((item) => ({
      ...item,
      ownerLabel: resolveMailboxOwnerLabel(item.createdBy, usersById),
    }))
    .sort((left, right) => left.address.localeCompare(right.address));
}

export function resolveMailboxRowActions(
  row: MailboxRow,
  canManage: boolean,
): MailboxRowActions {
  if (!canManage) {
    return { showEnable: false, showDisable: false };
  }
  return {
    showEnable: row.status === "suspended",
    showDisable: row.status === "active",
  };
}

export const MAILBOXES_PATH = "/api/mail/mailboxes";

export function mailboxSuspendPath(mailboxId: string): string {
  return `/api/mail/mailboxes/${encodeURIComponent(mailboxId)}/suspend`;
}

export function mailboxRestorePath(mailboxId: string): string {
  return `/api/mail/mailboxes/${encodeURIComponent(mailboxId)}/restore`;
}
