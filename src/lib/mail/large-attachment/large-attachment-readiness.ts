import { MailServiceError } from "@/lib/mail/errors";

/**
 * Large Attachment is an independently rolled out capability. It remains
 * disabled unless the deployment explicitly opts into the runtime.
 */
export const LARGE_ATTACHMENT_RUNTIME_ENABLED_ENV =
  "MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED" as const;

export const LARGE_ATTACHMENT_RUNTIME_NOT_READY_CODE =
  "LARGE_ATTACHMENT_RUNTIME_NOT_READY" as const;

type RuntimeEnvironment = Record<string, string | undefined>;

export type LargeAttachmentRuntimeReadinessOptions = {
  /**
   * Test-only seam for explicitly exercising the enabled implementation
   * without changing deployment configuration.
   */
  enabled?: boolean;
  env?: RuntimeEnvironment;
};

export function isLargeAttachmentRuntimeEnabled(
  env: RuntimeEnvironment = process.env,
): boolean {
  const configured = env[LARGE_ATTACHMENT_RUNTIME_ENABLED_ENV]
    ?.trim()
    .toLowerCase();
  return configured === "1" || configured === "true";
}

export function assertLargeAttachmentRuntimeReady(
  options: LargeAttachmentRuntimeReadinessOptions = {},
): void {
  const enabled =
    options.enabled ??
    isLargeAttachmentRuntimeEnabled(options.env ?? process.env);
  if (enabled) {
    return;
  }

  throw MailServiceError.validation("Large attachments are not available", {
    issueCode: LARGE_ATTACHMENT_RUNTIME_NOT_READY_CODE,
  });
}
