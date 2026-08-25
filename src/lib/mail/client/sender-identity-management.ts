import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";
import {
  MAIL_NOTIFICATION_SENDING_DOMAIN,
  MAIL_NOTIFICATION_SENDING_FROM_ADDRESS,
} from "@/lib/mail/notification-sending-domain";

export type SenderIdentityApiItem = {
  id: string;
  address: string;
  displayName: string | null;
  status: "active" | "suspended" | "deleted";
  defaultMailboxId: string | null;
  sentFolderMailboxId: string | null;
  aliasOfIdentityId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SenderIdentityMailboxOption = {
  id: string;
  address: string;
  displayName: string | null;
  status: "active" | "suspended" | "deleted";
};

export type SenderIdentityRow = SenderIdentityApiItem & {
  isDefaultSender: boolean;
};

export type SenderIdentityRowActions = {
  showEnable: boolean;
  showDisable: boolean;
  showSetDefault: boolean;
};

const DEFAULT_SENDER_STORAGE_PREFIX = "mail-admin-default-sender-identity:";

export function canManageSenderIdentity(
  capabilities: Pick<MailAdminCenterCapabilities, "senderIdentityManagement">,
): boolean {
  return capabilities.senderIdentityManagement;
}

export function isSystemNotificationSenderAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  if (normalized === MAIL_NOTIFICATION_SENDING_FROM_ADDRESS.toLowerCase()) {
    return true;
  }
  return normalized.endsWith(`@${MAIL_NOTIFICATION_SENDING_DOMAIN}`);
}

export function filterManageableSenderIdentities(
  items: SenderIdentityApiItem[],
): SenderIdentityApiItem[] {
  return items.filter(
    (item) =>
      item.status !== "deleted" && !isSystemNotificationSenderAddress(item.address),
  );
}

export function defaultSenderIdentityStorageKey(userId: string): string {
  return `${DEFAULT_SENDER_STORAGE_PREFIX}${userId}`;
}

export function readDefaultSenderIdentityId(userId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const stored = window.localStorage.getItem(defaultSenderIdentityStorageKey(userId));
  return stored?.trim() || null;
}

export function writeDefaultSenderIdentityId(
  userId: string,
  identityId: string,
): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(defaultSenderIdentityStorageKey(userId), identityId);
}

export function buildSenderIdentityRows(
  items: SenderIdentityApiItem[],
  defaultSenderIdentityId: string | null,
): SenderIdentityRow[] {
  return filterManageableSenderIdentities(items)
    .map((item) => ({
      ...item,
      isDefaultSender:
        defaultSenderIdentityId != null && item.id === defaultSenderIdentityId,
    }))
    .sort((left, right) => left.address.localeCompare(right.address));
}

export function resolveSenderIdentityRowActions(
  row: SenderIdentityRow,
  canManage: boolean,
): SenderIdentityRowActions {
  if (!canManage) {
    return {
      showEnable: false,
      showDisable: false,
      showSetDefault: false,
    };
  }

  return {
    showEnable: row.status === "suspended",
    showDisable: row.status === "active",
    showSetDefault: row.status === "active" && !row.isDefaultSender,
  };
}

export function filterActiveMailboxOptions(
  mailboxes: SenderIdentityMailboxOption[],
): SenderIdentityMailboxOption[] {
  return mailboxes
    .filter((mailbox) => mailbox.status === "active")
    .sort((left, right) => left.address.localeCompare(right.address));
}

export const SENDER_IDENTITIES_PATH = "/api/mail/sender-identities";

export function senderIdentitySuspendPath(identityId: string): string {
  return `/api/mail/sender-identities/${encodeURIComponent(identityId)}/suspend`;
}

export function senderIdentityRestorePath(identityId: string): string {
  return `/api/mail/sender-identities/${encodeURIComponent(identityId)}/restore`;
}
