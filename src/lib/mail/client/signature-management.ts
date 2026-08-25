import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";
import type { MailAccessAdminUser } from "@/lib/mail/client/mail-access-management";
import {
  filterManageableSenderIdentities,
  isSystemNotificationSenderAddress,
  type SenderIdentityApiItem,
} from "@/lib/mail/client/sender-identity-management";

export type SignatureVersionApiItem = {
  id: string;
  senderIdentityId: string;
  versionNumber: number;
  bodyText: string;
  bodyHtmlSanitized: string | null;
  hasHtml: boolean;
  isActive: boolean;
  createdByUserId: string | null;
  createdAt: string;
  retiredAt: string | null;
  retiredByUserId: string | null;
};

export type SignatureVersionAssetApiItem = {
  id: string;
  signatureVersionId: string;
  assetRef: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
};

export type SignatureEffectiveApiItem = SignatureVersionApiItem & {
  assets: SignatureVersionAssetApiItem[];
};

export type SignatureVersionRow = SignatureVersionApiItem & {
  name: string;
  ownerLabel: string;
};

export type SignatureVersionRowActions = {
  showSetDefault: boolean;
  showEdit: boolean;
};

export type SignatureEditorDraft = {
  bodyText: string;
  bodyHtml: string;
};

export type SignatureEditorMode = "create" | "edit";

export function canManageSignatures(
  capabilities: Pick<MailAdminCenterCapabilities, "signatureTemplateManagement">,
): boolean {
  return capabilities.signatureTemplateManagement;
}

export { isSystemNotificationSenderAddress };

export function filterManageableSignatureSenderIdentities(
  items: SenderIdentityApiItem[],
): SenderIdentityApiItem[] {
  return filterManageableSenderIdentities(items).filter(
    (item) => item.status === "active",
  );
}

export function resolveSignatureOwnerLabel(
  createdByUserId: string | null,
  usersById: Map<string, MailAccessAdminUser>,
): string {
  if (!createdByUserId) {
    return "—";
  }
  const user = usersById.get(createdByUserId);
  if (!user) {
    return createdByUserId;
  }
  return user.name || user.email;
}

export function formatSignatureVersionName(versionNumber: number): string {
  return `Version ${versionNumber}`;
}

export function buildSignatureVersionRows(
  items: SignatureVersionApiItem[],
  users: MailAccessAdminUser[],
): SignatureVersionRow[] {
  const usersById = new Map(users.map((user) => [user.id, user] as const));
  return items
    .map((item) => ({
      ...item,
      name: formatSignatureVersionName(item.versionNumber),
      ownerLabel: resolveSignatureOwnerLabel(item.createdByUserId, usersById),
    }))
    .sort((left, right) => right.versionNumber - left.versionNumber);
}

export function resolveSignatureVersionRowActions(
  row: SignatureVersionRow,
  canManage: boolean,
): SignatureVersionRowActions {
  if (!canManage) {
    return { showSetDefault: false, showEdit: false };
  }
  return {
    showSetDefault: !row.isActive,
    showEdit: true,
  };
}

export function draftFromSignatureVersion(
  version: Pick<SignatureVersionApiItem, "bodyText" | "bodyHtmlSanitized">,
): SignatureEditorDraft {
  return {
    bodyText: version.bodyText,
    bodyHtml: version.bodyHtmlSanitized ?? "",
  };
}

export function emptySignatureEditorDraft(): SignatureEditorDraft {
  return { bodyText: "", bodyHtml: "" };
}

export function isSignatureEditorDraftValid(draft: SignatureEditorDraft): boolean {
  return Boolean(draft.bodyText.trim() || draft.bodyHtml.trim());
}

export function buildSignaturePreviewHtml(
  draft: SignatureEditorDraft,
): string | null {
  const html = draft.bodyHtml.trim();
  if (html) {
    return html;
  }
  const text = draft.bodyText.trim();
  if (!text) {
    return null;
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("<br />");
}

export function signatureVersionsPath(senderIdentityId: string): string {
  return `/api/mail/sender-identities/${encodeURIComponent(senderIdentityId)}/signature/versions`;
}

export function signatureCurrentPath(senderIdentityId: string): string {
  return `/api/mail/sender-identities/${encodeURIComponent(senderIdentityId)}/signature`;
}

export function signatureVersionActivatePath(signatureVersionId: string): string {
  return `/api/mail/signature-versions/${encodeURIComponent(signatureVersionId)}/activate`;
}
