import { and, eq, isNull } from "drizzle-orm";
import type { MailMailbox } from "../../../drizzle/schema/mail-mailboxes";
import type { MailMailboxMember } from "../../../drizzle/schema/mail-mailbox-members";
import type { MailMessage } from "../../../drizzle/schema/mail-messages";
import type { MailMessageRecipient } from "../../../drizzle/schema/mail-message-recipients";
import type { MailRecipientType } from "../../../drizzle/schema/mail-message-recipients";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import { findMailboxById } from "@/lib/mail/mailbox-service";
import {
  assertEffectiveMailAccess,
  hasEffectiveGlobalMailRead,
} from "@/lib/permissions/mail";

export type MailReadAccessMode = "member" | "global_read";

export type MailReadAccessResult = {
  mailbox: MailMailbox;
  membership: MailMailboxMember | null;
  accessMode: MailReadAccessMode;
};

export type MailMessageReadFolder = "inbox" | "sent" | "trash";

export type MailMessageReadContext = {
  folder?: MailMessageReadFolder;
  allowTrashed?: boolean;
};

export type MailMessageReadPermissionResult = {
  message: MailMessage;
  mailboxAccess: MailReadAccessResult;
};

export type MailRecipientVisibilityContext = {
  actor: MailActorContext;
  message: Pick<MailMessage, "direction" | "createdBy" | "fromAddress" | "mailboxId">;
  mailbox: MailMailbox;
  mailboxAccess: MailReadAccessResult;
  membership: MailMailboxMember | null;
};

export type MailReadAuditEventInput = {
  actorUserId: string;
  mailboxId: string;
  messageId: string | null;
  accessMode: MailReadAccessMode;
  action: "mailbox_read" | "message_read" | "attachment_read";
  occurredAt: string;
};

/**
 * Future mail read audit persistence hook.
 * Storage is intentionally not implemented in Phase 2H-3A.
 */
export function recordMailReadAuditEvent(_input: MailReadAuditEventInput): void {
  // Reserved for a future durable audit table / stream.
}

export function hasGlobalMailReadGrant(actor: MailActorContext): boolean {
  return hasEffectiveGlobalMailRead(actor);
}

async function findActiveMailboxMembership(
  db: Database,
  mailboxId: string,
  userId: string,
): Promise<MailMailboxMember | null> {
  const [membership] = await db
    .select()
    .from(schema.mailMailboxMembers)
    .where(
      and(
        eq(schema.mailMailboxMembers.mailboxId, mailboxId),
        eq(schema.mailMailboxMembers.userId, userId),
        isNull(schema.mailMailboxMembers.revokedAt),
      ),
    )
    .limit(1);
  return membership ?? null;
}

function isPersonalMailboxOwner(
  mailbox: MailMailbox,
  actor: MailActorContext,
): boolean {
  return (
    mailbox.mailboxType === "personal" &&
    mailbox.createdBy != null &&
    mailbox.createdBy === actor.userId
  );
}

function assertMailboxIsReadable(mailbox: MailMailbox): void {
  if (mailbox.status !== "active") {
    throw MailServiceError.forbidden("Mailbox is not available for reading");
  }
}

/**
 * Validates mailbox-level read access for the current actor.
 *
 * Policy:
 * - Requires effective Mail access (root admin OR mail_user_access).
 * - Denies suspended/archived/deleted mailboxes.
 * - Shared mailbox: active membership with can_read.
 * - Personal mailbox: owner (created_by) OR active membership with can_read.
 * - global_mail_read or CRM root admin: supervision read without membership.
 */
export async function assertCanReadMailbox(
  db: Database,
  actor: MailActorContext,
  mailboxId: string,
): Promise<MailReadAccessResult> {
  assertEffectiveMailAccess(actor);

  const mailbox = await findMailboxById(db, mailboxId);
  if (!mailbox) {
    throw MailServiceError.notFound("Mailbox not found");
  }

  assertMailboxIsReadable(mailbox);

  const membership = await findActiveMailboxMembership(db, mailboxId, actor.userId);
  if (membership?.canRead === 1) {
    return {
      mailbox,
      membership,
      accessMode: "member",
    };
  }

  if (isPersonalMailboxOwner(mailbox, actor)) {
    return {
      mailbox,
      membership,
      accessMode: "member",
    };
  }

  if (hasGlobalMailReadGrant(actor)) {
    return {
      mailbox,
      membership: null,
      accessMode: "global_read",
    };
  }

  throw MailServiceError.forbidden("Mailbox read permission required");
}

function isTrashReadContext(context?: MailMessageReadContext): boolean {
  return context?.folder === "trash" || context?.allowTrashed === true;
}

function assertMessageTrashVisibility(
  message: MailMessage,
  context?: MailMessageReadContext,
): void {
  const isTrashed = message.trashedAt != null;
  if (isTrashed && !isTrashReadContext(context)) {
    throw MailServiceError.forbidden("Message is not available in this folder");
  }
  if (!isTrashed && context?.folder === "trash") {
    throw MailServiceError.notFound("Message not found");
  }
}

function assertMessageFolderAlignment(
  message: MailMessage,
  context?: MailMessageReadContext,
): void {
  if (!context?.folder || context.folder === "trash") {
    return;
  }

  if (context.folder === "inbox" && message.direction !== "inbound") {
    throw MailServiceError.notFound("Message not found");
  }

  if (context.folder === "sent" && message.direction !== "outbound") {
    throw MailServiceError.notFound("Message not found");
  }
}

/**
 * Validates message-level read access.
 *
 * Returns notFound (not forbidden) when the actor lacks mailbox visibility to
 * avoid leaking message existence across mailbox boundaries.
 */
export async function assertCanReadMessage(
  db: Database,
  actor: MailActorContext,
  messageId: string,
  context?: MailMessageReadContext,
): Promise<MailMessageReadPermissionResult> {
  assertEffectiveMailAccess(actor);

  const [message] = await db
    .select()
    .from(schema.mailMessages)
    .where(eq(schema.mailMessages.id, messageId))
    .limit(1);

  if (!message) {
    throw MailServiceError.notFound("Message not found");
  }

  let mailboxAccess: MailReadAccessResult;
  try {
    mailboxAccess = await assertCanReadMailbox(db, actor, message.mailboxId);
  } catch (error) {
    if (
      error instanceof MailServiceError &&
      (error.errorCode === "FORBIDDEN" || error.status === 403)
    ) {
      throw MailServiceError.notFound("Message not found");
    }
    throw error;
  }

  if (message.mailboxId !== mailboxAccess.mailbox.id) {
    throw MailServiceError.notFound("Message not found");
  }

  assertMessageTrashVisibility(message, context);
  assertMessageFolderAlignment(message, context);

  return {
    message,
    mailboxAccess,
  };
}

const MAIL_ACCESS_DISABLED_MESSAGE =
  "Mail access is not enabled for this user";

/**
 * Maps message read failures to public 404 for non-enumerating Mail APIs.
 * Preserves account-level 403 when Mail access is disabled.
 */
export function mapPublicMessageReadFailureToNotFound(error: unknown): never {
  if (error instanceof MailServiceError && error.status === 403) {
    if (error.message === MAIL_ACCESS_DISABLED_MESSAGE) {
      throw error;
    }
    throw MailServiceError.notFound("Message not found");
  }
  throw error;
}

/**
 * Same as assertCanReadMessage, but maps unreadable/wrong-context failures to 404.
 * Use at public API boundaries (attachment download, compose draft seed, etc.).
 */
export async function assertCanReadMessageForPublicApi(
  db: Database,
  actor: MailActorContext,
  messageId: string,
  context?: MailMessageReadContext,
): Promise<MailMessageReadPermissionResult> {
  try {
    return await assertCanReadMessage(db, actor, messageId, context);
  } catch (error) {
    mapPublicMessageReadFailureToNotFound(error);
  }
}

export function buildRecipientVisibilityContext(
  actor: MailActorContext,
  message: Pick<MailMessage, "direction" | "createdBy" | "fromAddress" | "mailboxId">,
  mailboxAccess: MailReadAccessResult,
): MailRecipientVisibilityContext {
  return {
    actor,
    message,
    mailbox: mailboxAccess.mailbox,
    mailboxAccess,
    membership: mailboxAccess.membership,
  };
}

/**
 * Returns whether the viewer may see Bcc recipient rows for a message.
 *
 * Bcc is visible to:
 * - Outbound author (created_by)
 * - Personal mailbox owner (created_by on mailbox)
 * - Members with can_manage_processing
 * - global_mail_read auditors
 */
export function canViewerSeeBccRecipients(
  context: MailRecipientVisibilityContext,
): boolean {
  if (context.mailboxAccess.accessMode === "global_read") {
    return true;
  }

  if (
    context.message.direction === "outbound" &&
    context.message.createdBy != null &&
    context.message.createdBy === context.actor.userId
  ) {
    return true;
  }

  if (isPersonalMailboxOwner(context.mailbox, context.actor)) {
    return true;
  }

  if (context.membership?.canManageProcessing === 1) {
    return true;
  }

  return false;
}

export type FilterableMailRecipient = Pick<
  MailMessageRecipient,
  "recipientType" | "address" | "displayName" | "sortOrder"
>;

/**
 * Filters message recipients for the current viewer.
 * To/Cc remain visible; Bcc rows are removed unless the viewer is authorized.
 */
export function filterRecipientsForViewer<T extends FilterableMailRecipient>(
  recipients: T[],
  context: MailRecipientVisibilityContext,
): T[] {
  if (canViewerSeeBccRecipients(context)) {
    return recipients;
  }

  return recipients.filter((recipient) => recipient.recipientType !== "bcc");
}

export function isVisibleRecipientType(
  recipientType: MailRecipientType,
  context: MailRecipientVisibilityContext,
): boolean {
  if (recipientType === "bcc") {
    return canViewerSeeBccRecipients(context);
  }
  return true;
}
