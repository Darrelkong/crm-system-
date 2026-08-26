import { MailServiceError } from "@/lib/mail/errors";

/**
 * Raw verification token APIs are LOCAL/TEST diagnostics only.
 * Production must never expose plaintext challenges through HTTP APIs.
 */
export function assertNotificationVerificationProofTokenApiAllowed(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND !== "1") {
    throw MailServiceError.notFound("Not found");
  }
  if (process.env.CF_PAGES === "1" || process.env.CF_WORKER === "1") {
    throw MailServiceError.notFound("Not found");
  }
}

export function isNotificationVerificationProofTokenApiAllowed(): boolean {
  try {
    assertNotificationVerificationProofTokenApiAllowed();
    return true;
  } catch {
    return false;
  }
}
