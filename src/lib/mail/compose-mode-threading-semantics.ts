import type { MailComposeMode } from "../../../drizzle/schema/mail-drafts";

export function isRfcReplyComposeMode(
  composeMode: MailComposeMode,
): composeMode is "reply" | "reply_all" {
  return composeMode === "reply" || composeMode === "reply_all";
}

export function isForwardComposeMode(
  composeMode: MailComposeMode,
): composeMode is "forward" {
  return composeMode === "forward";
}

/**
 * Phase 6C threading gate: only reply modes join the source canonical thread.
 * Forward must create a NEW thread even when replyToMessageId stores source provenance.
 */
export function shouldJoinSourceThread(composeMode: MailComposeMode): boolean {
  return isRfcReplyComposeMode(composeMode);
}

/**
 * Phase 6C RFC gate: only reply modes emit In-Reply-To / References reply lineage.
 */
export function shouldEmitRfcReplyHeaders(composeMode: MailComposeMode): boolean {
  return isRfcReplyComposeMode(composeMode);
}

/**
 * Non-null replyToMessageId alone must NOT imply RFC reply semantics.
 * Callers must consult composeMode via shouldJoinSourceThread / shouldEmitRfcReplyHeaders.
 */
export function replyToMessageIdImpliesRfcReplyRelationship(
  composeMode: MailComposeMode,
): boolean {
  return isRfcReplyComposeMode(composeMode);
}
