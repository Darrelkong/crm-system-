import type { MailMessage, MailQuotedOriginal } from "./types";
import { normalizeEmail } from "./recipient-utils";
import { replySubject, forwardSubject } from "./subject-utils";

const INTERNAL_DOMAIN = "echfronthk.com";

export function isInternalAddress(email: string): boolean {
  const normalized = normalizeEmail(email);
  return normalized.endsWith(`@${INTERNAL_DOMAIN}`);
}

export function replyFromMailbox(message: MailMessage): string {
  return message.mailbox;
}

export function buildReplyDraft(message: MailMessage) {
  return {
    from: replyFromMailbox(message),
    to: [message.fromEmail],
    cc: [] as string[],
    bcc: [] as string[],
    subject: replySubject(message.subject),
    replyToId: message.id,
    mode: "reply" as const,
    quotedOriginal: buildQuotedOriginal(message),
  };
}

export function hasReplyAllTargets(message: MailMessage): boolean {
  const own = normalizeEmail(message.mailbox);
  const others = new Set<string>();
  for (const addr of [message.fromEmail, ...message.to, ...(message.cc ?? [])]) {
    const n = normalizeEmail(addr);
    if (n && n !== own) others.add(n);
  }
  return others.size > 1 || (message.cc?.length ?? 0) > 0;
}

export function buildReplyAllDraft(message: MailMessage) {
  const own = normalizeEmail(message.mailbox);
  const toSet = new Set<string>();
  const ccSet = new Set<string>();

  const fromSender = normalizeEmail(message.fromEmail);
  if (fromSender && fromSender !== own) toSet.add(message.fromEmail);

  for (const addr of message.to) {
    const n = normalizeEmail(addr);
    if (n && n !== own && n !== fromSender) toSet.add(addr);
  }
  for (const addr of message.cc ?? []) {
    const n = normalizeEmail(addr);
    if (n && n !== own) ccSet.add(addr);
  }

  return {
    from: replyFromMailbox(message),
    to: [...toSet],
    cc: [...ccSet],
    bcc: [] as string[],
    subject: replySubject(message.subject),
    replyToId: message.id,
    mode: "reply_all" as const,
    quotedOriginal: buildQuotedOriginal(message),
  };
}

export function buildForwardDraft(message: MailMessage) {
  return {
    from: replyFromMailbox(message),
    to: [] as string[],
    cc: [] as string[],
    bcc: [] as string[],
    subject: forwardSubject(message.subject),
    mode: "forward" as const,
    quotedOriginal: buildQuotedOriginal(message),
    forwardAttachments: message.attachments,
    selectedForwardAttachmentIds: [] as string[],
  };
}

export function buildQuotedOriginal(message: MailMessage): MailQuotedOriginal {
  return {
    fromName: message.fromName,
    fromEmail: message.fromEmail,
    sentAt: message.sentAt,
    subject: message.subject,
    to: message.to,
    body: message.body,
  };
}

export function shouldShowReplyAllWarning(
  to: string[],
  cc: string[],
): boolean {
  const external = [...to, ...cc].filter((e) => !isInternalAddress(e));
  if (external.length > 5) return true;
  const hasInternal = [...to, ...cc].some((e) => isInternalAddress(e));
  const hasExternal = external.length > 0;
  return hasInternal && hasExternal;
}
