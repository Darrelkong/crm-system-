import type { MailSessionContext } from "@/lib/mail/mail-session-context";
import type {
  MailAccessAdminUser,
  MailAccessApiItem,
} from "@/lib/mail/client/mail-access-management";
import type { NotificationIdentityApiItem } from "@/lib/mail/client/notification-identity-management";
import type { NotificationProofRunApiItem } from "@/lib/mail/client/proof-diagnostics";
import type { MailboxApiItem } from "@/lib/mail/client/mailbox-management";
import { MAILBOXES_PATH, mailboxRestorePath, mailboxSuspendPath } from "@/lib/mail/client/mailbox-management";
import type {
  MailboxMemberApiItem,
  MailboxMemberPermissionDraft,
} from "@/lib/mail/client/shared-mailbox-management";
import {
  mailboxMemberPath,
  mailboxMemberRevokePath,
  mailboxMembersPath,
} from "@/lib/mail/client/shared-mailbox-management";
import {
  approvalApprovePath,
  approvalPath,
  approvalReturnPath,
  buildApprovalsListPath,
  outboundRevisionPath,
  type ApprovalStatus,
  type ApprovalWorkflowScope,
} from "@/lib/mail/client/approval-workflow-management";
import type {
  ApprovalApiItem,
  OutboundRevisionApiItem,
} from "@/lib/mail/client/approval-workflow-management";
import {
  signatureCurrentPath,
  signatureVersionActivatePath,
  signatureVersionsPath,
} from "@/lib/mail/client/signature-management";
import type {
  SignatureEffectiveApiItem,
  SignatureVersionApiItem,
} from "@/lib/mail/client/signature-management";
import type {
  SenderIdentityApiItem,
  SenderIdentityMailboxOption,
} from "@/lib/mail/client/sender-identity-management";
import {
  SENDER_IDENTITIES_PATH,
  senderIdentityRestorePath,
  senderIdentitySuspendPath,
} from "@/lib/mail/client/sender-identity-management";
import type { SenderIdentityGrantApiItem } from "@/lib/mail/client/sender-identity-grant-management";
import {
  senderIdentityGrantRevokePath,
  senderIdentityGrantsPath,
} from "@/lib/mail/client/sender-identity-grant-management";
import {
  NOTIFICATION_IDENTITY_SELF_ISSUE_TOKEN_PATH,
  notificationIdentitiesPath,
  notificationIdentityVerifyPath,
} from "@/lib/mail/client/notification-identity-management";
import {
  COMPOSE_CONTEXT_PATH,
  DRAFTS_PATH,
  draftDiscardPath,
  draftPath,
  type ComposeContextOption,
  type DraftApiItem,
  type DraftDetailApiItem,
} from "@/lib/mail/client/draft-management";
import {
  approvalResubmitPath,
  buildAdminDirectSendIdempotencyKey,
  draftAdminDirectRevisionPath,
  draftRevisionPath,
  sendAdminDirectPath,
  submitRevisionApprovalPath,
} from "@/lib/mail/client/compose-submission";
import {
  approvalSendOperationPath,
  sendOperationDeliveryPath,
  type SendDeliveryLifecycleApiItem,
  type SendOperationApiItem,
} from "@/lib/mail/client/approved-outbound-queue";

export {
  createComposeDraftFromMessage,
  resolveComposeDraftSeedErrorMessageKey,
} from "@/lib/mail/client/compose-draft-seed-client";
export type { CreateComposeDraftFromMessageInput } from "@/lib/mail/client/compose-draft-seed-client";

type MailSessionResponse = MailSessionContext & {
  error?: string;
  errorCode?: string;
};

type ApiErrorBody = {
  error?: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
};

async function readApiError(
  res: Response,
  fallback: string,
): Promise<{
  error: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}> {
  const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
  return {
    error: data.error ?? fallback,
    errorCode: data.errorCode,
    metadata: data.metadata,
  };
}

export async function fetchMailSession(): Promise<{
  ok: true;
  session: MailSessionContext;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch("/api/mail/me", { cache: "no-store" });
  const data = (await res.json()) as MailSessionResponse;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: data.error ?? "Failed to load mail session",
      errorCode: data.errorCode,
    };
  }
  return { ok: true, session: data };
}

export async function fetchMailAccessList(): Promise<{
  ok: true;
  items: MailAccessApiItem[];
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch("/api/mail/access", { cache: "no-store" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to load mail access");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { items?: MailAccessApiItem[] };
  return { ok: true, items: data.items ?? [] };
}

export async function fetchAdminUsersForMailAccess(): Promise<{
  ok: true;
  items: MailAccessAdminUser[];
} | {
  ok: false;
  status: number;
  error: string;
}> {
  const res = await fetch("/api/admin/users", { cache: "no-store" });
  if (!res.ok) {
    const { error } = await readApiError(res, "Failed to load users");
    return { ok: false, status: res.status, error };
  }
  const data = (await res.json()) as { items?: MailAccessAdminUser[] };
  return { ok: true, items: data.items ?? [] };
}

export async function postMailAccessEnable(userId: string): Promise<{
  ok: true;
  item: MailAccessApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(
    `/api/mail/access/${encodeURIComponent(userId)}/enable`,
    { method: "POST" },
  );
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to enable mail access");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: MailAccessApiItem };
  return { ok: true, item: data.item };
}

export async function postMailAccessDisable(userId: string): Promise<{
  ok: true;
  item: MailAccessApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(
    `/api/mail/access/${encodeURIComponent(userId)}/disable`,
    { method: "POST" },
  );
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to disable mail access");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: MailAccessApiItem };
  return { ok: true, item: data.item };
}

export async function fetchNotificationIdentities(userId: string): Promise<{
  ok: true;
  items: NotificationIdentityApiItem[];
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(notificationIdentitiesPath(userId), {
    cache: "no-store",
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load notification identities",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { items?: NotificationIdentityApiItem[] };
  return { ok: true, items: data.items ?? [] };
}

export async function createNotificationIdentity(
  userId: string,
  email: string,
): Promise<{
  ok: true;
  item: NotificationIdentityApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(notificationIdentitiesPath(userId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to create notification identity",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: NotificationIdentityApiItem };
  return { ok: true, item: data.item };
}

export async function sendTargetNotificationVerificationChallenge(
  userId: string,
): Promise<{
  ok: true;
  item: NotificationIdentityApiItem;
  delivery: {
    status: "transport_disabled" | "queued" | "sent" | "delivery_failed";
    destinationEmail: string;
  };
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}> {
  const res = await fetch(
    `/api/mail/access/${encodeURIComponent(userId)}/notification-identities/send-verification`,
    { method: "POST" },
  );
  if (!res.ok) {
    const { error, errorCode, metadata } = await readApiError(
      res,
      "Failed to send verification challenge",
    );
    return { ok: false, status: res.status, error, errorCode, metadata };
  }
  const data = (await res.json()) as {
    item?: NotificationIdentityApiItem;
    delivery?: {
      status: "transport_disabled" | "queued" | "sent" | "delivery_failed";
      destinationEmail: string;
    };
  };
  if (!data.item || !data.delivery) {
    return {
      ok: false,
      status: 500,
      error: "Invalid verification send response",
    };
  }
  return { ok: true, item: data.item, delivery: data.delivery };
}

export async function issueSelfNotificationVerificationToken(): Promise<{
  ok: true;
  verificationToken: string;
  expiresAt: string;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(NOTIFICATION_IDENTITY_SELF_ISSUE_TOKEN_PATH, {
    method: "POST",
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to issue verification token",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as {
    verificationToken?: string;
    item?: { expiresAt?: string };
  };
  if (!data.verificationToken || !data.item?.expiresAt) {
    return {
      ok: false,
      status: 500,
      error: "Invalid verification token response",
    };
  }
  return {
    ok: true,
    verificationToken: data.verificationToken,
    expiresAt: data.item.expiresAt,
  };
}

export async function verifyNotificationIdentity(
  identityId: string,
  token: string,
): Promise<{
  ok: true;
  item: NotificationIdentityApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}> {
  const res = await fetch(notificationIdentityVerifyPath(identityId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const { error, errorCode, metadata } = await readApiError(
      res,
      "Failed to verify notification identity",
    );
    return { ok: false, status: res.status, error, errorCode, metadata };
  }
  const data = (await res.json()) as { item: NotificationIdentityApiItem };
  return { ok: true, item: data.item };
}

export async function fetchNotificationProofRuns(): Promise<{
  ok: true;
  items: NotificationProofRunApiItem[];
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch("/api/mail/admin/notification-proof", {
    cache: "no-store",
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load notification proof runs",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { items?: NotificationProofRunApiItem[] };
  return { ok: true, items: data.items ?? [] };
}

export async function fetchSenderIdentities(): Promise<{
  ok: true;
  items: SenderIdentityApiItem[];
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(SENDER_IDENTITIES_PATH, { cache: "no-store" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load sender identities",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { items?: SenderIdentityApiItem[] };
  return { ok: true, items: data.items ?? [] };
}

export async function createSenderIdentity(input: {
  address: string;
  displayName?: string;
  defaultMailboxId: string;
}): Promise<{
  ok: true;
  item: SenderIdentityApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(SENDER_IDENTITIES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to create sender identity",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: SenderIdentityApiItem };
  return { ok: true, item: data.item };
}

export async function postSenderIdentitySuspend(identityId: string): Promise<{
  ok: true;
  item: SenderIdentityApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(senderIdentitySuspendPath(identityId), {
    method: "POST",
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to disable sender identity",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: SenderIdentityApiItem };
  return { ok: true, item: data.item };
}

export async function postSenderIdentityRestore(identityId: string): Promise<{
  ok: true;
  item: SenderIdentityApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(senderIdentityRestorePath(identityId), {
    method: "POST",
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to enable sender identity",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: SenderIdentityApiItem };
  return { ok: true, item: data.item };
}

export async function fetchSenderIdentityGrants(identityId: string): Promise<{
  ok: true;
  items: SenderIdentityGrantApiItem[];
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(senderIdentityGrantsPath(identityId), { cache: "no-store" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load sender identity grants",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { items?: SenderIdentityGrantApiItem[] };
  return { ok: true, items: data.items ?? [] };
}

export async function grantSenderIdentityAccess(
  identityId: string,
  input: {
    targetUserId: string;
    canSend?: boolean;
    canReply?: boolean;
  },
): Promise<{
  ok: true;
  item: SenderIdentityGrantApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(senderIdentityGrantsPath(identityId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to grant sender identity access",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: SenderIdentityGrantApiItem };
  return { ok: true, item: data.item };
}

export async function revokeSenderIdentityGrant(grantId: string): Promise<{
  ok: true;
  item: SenderIdentityGrantApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(senderIdentityGrantRevokePath(grantId), {
    method: "POST",
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to revoke sender identity grant",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: SenderIdentityGrantApiItem };
  return { ok: true, item: data.item };
}

export async function fetchMailboxesForSenderIdentity(): Promise<{
  ok: true;
  items: SenderIdentityMailboxOption[];
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(MAILBOXES_PATH, { cache: "no-store" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to load mailboxes");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      address: string;
      displayName: string | null;
      status: SenderIdentityMailboxOption["status"];
    }>;
  };
  return {
    ok: true,
    items: (data.items ?? []).map((item) => ({
      id: item.id,
      address: item.address,
      displayName: item.displayName,
      status: item.status,
    })),
  };
}

export async function fetchMailboxes(): Promise<{
  ok: true;
  items: MailboxApiItem[];
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(MAILBOXES_PATH, { cache: "no-store" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to load mailboxes");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { items?: MailboxApiItem[] };
  return { ok: true, items: data.items ?? [] };
}

export async function createMailbox(input: {
  address: string;
  displayName?: string;
  mailboxType: "personal" | "shared";
  ownerUserId?: string;
}): Promise<{
  ok: true;
  item: MailboxApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(MAILBOXES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to create mailbox");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: MailboxApiItem };
  return { ok: true, item: data.item };
}

export async function postMailboxSuspend(mailboxId: string): Promise<{
  ok: true;
  item: MailboxApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(mailboxSuspendPath(mailboxId), { method: "POST" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to disable mailbox");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: MailboxApiItem };
  return { ok: true, item: data.item };
}

export async function postMailboxRestore(mailboxId: string): Promise<{
  ok: true;
  item: MailboxApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(mailboxRestorePath(mailboxId), { method: "POST" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to enable mailbox");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: MailboxApiItem };
  return { ok: true, item: data.item };
}

export async function fetchSignatureVersions(senderIdentityId: string): Promise<{
  ok: true;
  items: SignatureVersionApiItem[];
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(signatureVersionsPath(senderIdentityId), {
    cache: "no-store",
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load signature versions",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { items?: SignatureVersionApiItem[] };
  return { ok: true, items: data.items ?? [] };
}

export async function fetchCurrentSignature(senderIdentityId: string): Promise<{
  ok: true;
  item: SignatureEffectiveApiItem | null;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(signatureCurrentPath(senderIdentityId), {
    cache: "no-store",
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load signature",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item?: SignatureEffectiveApiItem | null };
  return { ok: true, item: data.item ?? null };
}

export async function createSignatureVersion(
  senderIdentityId: string,
  input: { bodyText?: string; bodyHtml?: string },
): Promise<{
  ok: true;
  item: SignatureVersionApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(signatureVersionsPath(senderIdentityId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to create signature version",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: SignatureVersionApiItem };
  return { ok: true, item: data.item };
}

export async function activateSignatureVersion(signatureVersionId: string): Promise<{
  ok: true;
  item: SignatureVersionApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(signatureVersionActivatePath(signatureVersionId), {
    method: "POST",
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to activate signature version",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: SignatureVersionApiItem };
  return { ok: true, item: data.item };
}

export async function fetchApprovals(input: {
  scope: ApprovalWorkflowScope;
  status?: ApprovalStatus;
}): Promise<{
  ok: true;
  items: ApprovalApiItem[];
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(buildApprovalsListPath(input), { cache: "no-store" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load approvals",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { items?: ApprovalApiItem[] };
  return { ok: true, items: data.items ?? [] };
}

export async function fetchApproval(approvalId: string): Promise<{
  ok: true;
  item: ApprovalApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(approvalPath(approvalId), { cache: "no-store" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load approval",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: ApprovalApiItem };
  return { ok: true, item: data.item };
}

export async function fetchOutboundRevision(revisionId: string): Promise<{
  ok: true;
  item: OutboundRevisionApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(outboundRevisionPath(revisionId), { cache: "no-store" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load outbound revision",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: OutboundRevisionApiItem };
  return { ok: true, item: data.item };
}

export async function postApprovalApprove(
  approvalId: string,
  expectedWorkflowVersion: number,
): Promise<{
  ok: true;
  item: ApprovalApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(approvalApprovePath(approvalId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedWorkflowVersion }),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to approve submission",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: ApprovalApiItem };
  return { ok: true, item: data.item };
}

export async function postApprovalReturn(
  approvalId: string,
  input: { expectedWorkflowVersion: number; note: string },
): Promise<{
  ok: true;
  item: ApprovalApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(approvalReturnPath(approvalId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to reject submission",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: ApprovalApiItem };
  return { ok: true, item: data.item };
}

export async function fetchMailboxMembers(mailboxId: string): Promise<{
  ok: true;
  items: MailboxMemberApiItem[];
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(mailboxMembersPath(mailboxId), { cache: "no-store" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load mailbox members",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { items?: MailboxMemberApiItem[] };
  return { ok: true, items: data.items ?? [] };
}

export async function grantMailboxMember(
  mailboxId: string,
  input: { targetUserId: string } & MailboxMemberPermissionDraft,
): Promise<{
  ok: true;
  item: MailboxMemberApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(mailboxMembersPath(mailboxId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to add mailbox member",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: MailboxMemberApiItem };
  return { ok: true, item: data.item };
}

export async function updateMailboxMemberPermissions(
  memberId: string,
  input: MailboxMemberPermissionDraft,
): Promise<{
  ok: true;
  item: MailboxMemberApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(mailboxMemberPath(memberId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to update mailbox member",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: MailboxMemberApiItem };
  return { ok: true, item: data.item };
}

export async function revokeMailboxMember(memberId: string): Promise<{
  ok: true;
  item: MailboxMemberApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(mailboxMemberRevokePath(memberId), { method: "POST" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to remove mailbox member",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: MailboxMemberApiItem };
  return { ok: true, item: data.item };
}

export async function fetchComposeContext(): Promise<{
  ok: true;
  items: ComposeContextOption[];
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(COMPOSE_CONTEXT_PATH, { cache: "no-store" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load compose options",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { items?: ComposeContextOption[] };
  return { ok: true, items: data.items ?? [] };
}

export async function fetchDrafts(input?: {
  mailboxId?: string;
}): Promise<{
  ok: true;
  items: DraftApiItem[];
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const params = new URLSearchParams();
  if (input?.mailboxId) {
    params.set("mailboxId", input.mailboxId);
  }
  const query = params.toString();
  const url = query ? `${DRAFTS_PATH}?${query}` : DRAFTS_PATH;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to load drafts");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { items?: DraftApiItem[] };
  return { ok: true, items: data.items ?? [] };
}

export async function fetchDraft(draftId: string): Promise<{
  ok: true;
  item: DraftDetailApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(draftPath(draftId), { cache: "no-store" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to load draft");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: DraftDetailApiItem };
  return { ok: true, item: data.item };
}

export async function createDraft(input: {
  senderIdentityId: string;
  mailboxId: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  allowEmptyShell?: boolean;
  recipients?: Array<{
    recipientType: "to" | "cc" | "bcc";
    address: string;
    displayName?: string;
    sortOrder?: number;
  }>;
}): Promise<{
  ok: true;
  created: boolean;
  item: DraftDetailApiItem | null;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(DRAFTS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to create draft");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as {
    created?: boolean;
    item?: DraftDetailApiItem | null;
  };
  return {
    ok: true,
    created: Boolean(data.created),
    item: data.item ?? null,
  };
}

export async function updateDraft(
  draftId: string,
  input: {
    expectedAutosaveVersion: number;
    senderIdentityId?: string;
    mailboxId?: string;
    subject?: string;
    bodyText?: string;
    bodyHtml?: string;
    recipients?: Array<{
      recipientType: "to" | "cc" | "bcc";
      address: string;
      displayName?: string;
      sortOrder?: number;
    }>;
  },
): Promise<{
  ok: true;
  item: DraftDetailApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(draftPath(draftId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to update draft");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: DraftDetailApiItem };
  return { ok: true, item: data.item };
}

export async function discardDraft(draftId: string): Promise<{
  ok: true;
  item: DraftDetailApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(draftDiscardPath(draftId), { method: "POST" });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(res, "Failed to discard draft");
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: DraftDetailApiItem };
  return { ok: true, item: data.item };
}

type OutboundRevisionCreateApiItem = {
  id: string;
  revisionChainId: string;
  revisionNumber: number;
  sourceDraftId: string | null;
  revisionKind: string;
  subject: string;
};

export async function createDraftRevision(
  draftId: string,
  input: { expectedAutosaveVersion: number },
): Promise<{
  ok: true;
  item: OutboundRevisionCreateApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(draftRevisionPath(draftId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to create outbound revision",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: OutboundRevisionCreateApiItem };
  return { ok: true, item: data.item };
}

export async function createAdminDirectDraftRevision(
  draftId: string,
  input: { expectedAutosaveVersion: number },
): Promise<{
  ok: true;
  item: OutboundRevisionCreateApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(draftAdminDirectRevisionPath(draftId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to create admin-direct revision",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: OutboundRevisionCreateApiItem };
  return { ok: true, item: data.item };
}

export async function initiateAdminDirectSend(
  revisionId: string,
  input: { idempotencyKey: string },
): Promise<{
  ok: true;
  item: SendOperationApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(sendAdminDirectPath(revisionId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to initiate admin-direct send",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: SendOperationApiItem };
  return { ok: true, item: data.item };
}

export async function submitRevisionForApproval(
  revisionId: string,
  input?: { priority?: "normal" | "urgent" },
): Promise<{
  ok: true;
  item: ApprovalApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(submitRevisionApprovalPath(revisionId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to submit for approval",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: ApprovalApiItem };
  return { ok: true, item: data.item };
}

export async function postApprovalResubmit(
  approvalId: string,
  input: {
    revisionId: string;
    expectedWorkflowVersion: number;
    priority?: "normal" | "urgent";
  },
): Promise<{
  ok: true;
  item: ApprovalApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(approvalResubmitPath(approvalId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to resubmit for approval",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: ApprovalApiItem };
  return { ok: true, item: data.item };
}

export async function fetchSendOperationForApproval(approvalId: string): Promise<{
  ok: true;
  item: SendOperationApiItem | null;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(approvalSendOperationPath(approvalId), {
    cache: "no-store",
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load send operation",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item?: SendOperationApiItem | null };
  return { ok: true, item: data.item ?? null };
}

export async function fetchSendOperationDelivery(sendOperationId: string): Promise<{
  ok: true;
  item: SendDeliveryLifecycleApiItem;
} | {
  ok: false;
  status: number;
  error: string;
  errorCode?: string;
}> {
  const res = await fetch(sendOperationDeliveryPath(sendOperationId), {
    cache: "no-store",
  });
  if (!res.ok) {
    const { error, errorCode } = await readApiError(
      res,
      "Failed to load send delivery lifecycle",
    );
    return { ok: false, status: res.status, error, errorCode };
  }
  const data = (await res.json()) as { item: SendDeliveryLifecycleApiItem };
  return { ok: true, item: data.item };
}
