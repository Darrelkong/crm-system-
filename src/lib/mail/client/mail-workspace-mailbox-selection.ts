import type { AccessibleMailboxView } from "@/lib/mail/client/mail-read-types";

export type ResolveEffectiveMailboxIdInput = {
  selectedMailboxId: string | null;
  mailboxes: readonly Pick<AccessibleMailboxView, "id">[];
  /**
   * Production bootstrap may still pick the first accessible mailbox when several
   * exist and none is selected. Workspace folder actions do not use this path.
   */
  bootstrapFallbackToFirst?: boolean;
};

/**
 * Resolves the mailbox ID that should drive production read/draft operations.
 * UI visibility of mailbox switchers must not affect this resolution.
 */
export function resolveEffectiveMailboxId(
  input: ResolveEffectiveMailboxIdInput,
): string | null {
  if (input.selectedMailboxId) {
    if (input.mailboxes.length === 0) {
      return input.selectedMailboxId;
    }

    const accessibleIds = new Set(input.mailboxes.map((mailbox) => mailbox.id));
    if (accessibleIds.has(input.selectedMailboxId)) {
      return input.selectedMailboxId;
    }
  }

  if (input.mailboxes.length === 1) {
    return input.mailboxes[0]!.id;
  }

  if (input.bootstrapFallbackToFirst && input.mailboxes.length > 1) {
    return input.mailboxes[0]!.id;
  }

  return null;
}
