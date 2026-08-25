import { LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV } from "@/lib/mail/local-attachment-verification-fixture/constants";

export class LocalMailAttachmentVerifyFixtureGuardError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalMailAttachmentVerifyFixtureGuardError";
    this.code = code;
  }
}

export type LocalMailAttachmentVerifyCliTarget = {
  local: boolean;
  remote: boolean;
};

export function parseLocalMailAttachmentVerifyCliTarget(
  argv: string[],
): LocalMailAttachmentVerifyCliTarget {
  return {
    local: argv.includes("--local"),
    remote: argv.includes("--remote"),
  };
}

export function assertLocalMailAttachmentVerifyFixtureAllowed(
  target: LocalMailAttachmentVerifyCliTarget = { local: false, remote: false },
): void {
  if (process.env[LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV] !== "1") {
    throw new LocalMailAttachmentVerifyFixtureGuardError(
      "OPT_IN_REQUIRED",
      `${LOCAL_MAIL_ATTACHMENT_VERIFY_OPT_IN_ENV}=1 is required for local mail attachment verification fixtures`,
    );
  }

  if (target.remote) {
    throw new LocalMailAttachmentVerifyFixtureGuardError(
      "REMOTE_FORBIDDEN",
      "Remote D1/R2 is forbidden for local mail attachment verification fixtures",
    );
  }

  if (!target.local) {
    throw new LocalMailAttachmentVerifyFixtureGuardError(
      "LOCAL_FLAG_REQUIRED",
      "Pass --local to target wrangler local D1 (.wrangler/state/v3/d1) and ATTACHMENTS only",
    );
  }

  if (process.env.CF_PAGES === "1" || process.env.CF_WORKER === "1") {
    throw new LocalMailAttachmentVerifyFixtureGuardError(
      "DEPLOYED_WORKER_FORBIDDEN",
      "Local mail attachment verification fixtures cannot run in a deployed Worker context",
    );
  }
}

export const LOCAL_MAIL_ATTACHMENT_VERIFY_D1_HINT =
  ".wrangler/state/v3/d1 (crm-db via getPlatformProxy, local only)";
