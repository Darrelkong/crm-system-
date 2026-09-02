import {
  InboundEmailIngressError,
  type CloudflareForwardableEmailMessage,
} from "@/lib/mail/cloudflare-email-inbound-adapter";

/** Generic SMTP-safe reject reason — no mailbox/user/internal identifiers. */
export const INBOUND_EMAIL_RECIPIENT_REJECT_REASON =
  "Recipient address is not available." as const;

const RECIPIENT_REJECT_INGRESS_CODES = new Set<
  InboundEmailIngressError["code"]
>(["UNKNOWN_RECIPIENT", "RECIPIENT_NOT_ACCEPTABLE", "MISSING_ENVELOPE_RECIPIENT"]);

export function isInboundRecipientRejectIngressError(error: unknown): boolean {
  return (
    error instanceof InboundEmailIngressError &&
    RECIPIENT_REJECT_INGRESS_CODES.has(error.code)
  );
}

/**
 * Reject at the Cloudflare Email Worker boundary when recipient validity is
 * deterministically known. Returns true when setReject was applied.
 */
export function rejectInboundEmailRecipient(
  message: Pick<CloudflareForwardableEmailMessage, "setReject">,
  error: unknown,
): boolean {
  if (!isInboundRecipientRejectIngressError(error)) {
    return false;
  }
  if (typeof message.setReject !== "function") {
    return false;
  }
  message.setReject(INBOUND_EMAIL_RECIPIENT_REJECT_REASON);
  return true;
}
