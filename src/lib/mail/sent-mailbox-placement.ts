import type { MailSenderIdentity } from "../../../drizzle/schema/mail-sender-identities";
import { MailServiceError } from "@/lib/mail/errors";

/**
 * Resolves the canonical Sent mailbox for outbound message materialization.
 *
 * Frozen evidence:
 * - `mail_sender_identities.sent_folder_mailbox_id` — named Sent-folder placement (0052).
 * - `compose-authorization.ts` CASE A: when `default_mailbox_id` exists, compose uses
 *   default; `sent_folder_mailbox_id` is NOT an alternate Compose mailbox — implying
 *   a distinct Sent placement when both are set.
 * - 0052 CHECK: `default_mailbox_id IS NOT NULL OR sent_folder_mailbox_id IS NOT NULL`.
 * - 0059: materializes canonical outbound mail_message "in Sent" after acceptance.
 *
 * Rule:
 *   1. When `sent_folder_mailbox_id` IS NOT NULL → use it (canonical Sent folder).
 *   2. When `sent_folder_mailbox_id` IS NULL → use `default_mailbox_id` (required by CHECK).
 *
 * Do NOT use `revision.mailbox_id` — compose mailbox may differ from Sent folder.
 */
export function resolveSentMaterializationMailboxId(
  identity: Pick<MailSenderIdentity, "sentFolderMailboxId" | "defaultMailboxId">,
): string {
  if (identity.sentFolderMailboxId) {
    return identity.sentFolderMailboxId;
  }
  if (identity.defaultMailboxId) {
    return identity.defaultMailboxId;
  }
  throw MailServiceError.integrityConflict(
    "Sender identity missing Sent materialization mailbox",
  );
}
