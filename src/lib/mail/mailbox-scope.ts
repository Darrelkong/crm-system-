import { isCrmRootAdmin } from "@/lib/permissions/mail";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";

export type MailboxScope = "single" | "all";

/**
 * `all` is an aggregate read scope, never a mailbox identifier.
 * Missing scope preserves the existing single-mailbox API contract.
 */
export function parseMailboxScope(value: string | null): MailboxScope {
  if (value == null || value.trim() === "") {
    return "single";
  }
  const normalized = value.trim();
  if (normalized === "single" || normalized === "all") {
    return normalized;
  }
  throw MailServiceError.validation("scope must be either single or all");
}

export function assertCanUseAllMailboxScope(actor: MailActorContext): void {
  if (!isCrmRootAdmin(actor)) {
    throw MailServiceError.forbidden(
      "CRM Admin role required for All Mailboxes",
    );
  }
}
