import { LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV } from "@/lib/mail/local-reply-verification-fixture/constants";

export class LocalMailReplyVerifyFixtureGuardError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalMailReplyVerifyFixtureGuardError";
    this.code = code;
  }
}

export type LocalMailReplyVerifyCliTarget = {
  local: boolean;
  remote: boolean;
};

export function parseLocalMailReplyVerifyCliTarget(
  argv: string[],
): LocalMailReplyVerifyCliTarget {
  return {
    local: argv.includes("--local"),
    remote: argv.includes("--remote"),
  };
}

export function assertLocalMailReplyVerifyFixtureAllowed(
  target: LocalMailReplyVerifyCliTarget = { local: false, remote: false },
): void {
  if (process.env[LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV] !== "1") {
    throw new LocalMailReplyVerifyFixtureGuardError(
      "OPT_IN_REQUIRED",
      `${LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV}=1 is required for local mail reply verification fixtures`,
    );
  }

  if (target.remote) {
    throw new LocalMailReplyVerifyFixtureGuardError(
      "REMOTE_FORBIDDEN",
      "Remote D1 is forbidden for local mail reply verification fixtures",
    );
  }

  if (!target.local) {
    throw new LocalMailReplyVerifyFixtureGuardError(
      "LOCAL_FLAG_REQUIRED",
      "Pass --local to target wrangler local D1 (.wrangler/state/v3/d1) only",
    );
  }

  if (process.env.CF_PAGES === "1" || process.env.CF_WORKER === "1") {
    throw new LocalMailReplyVerifyFixtureGuardError(
      "DEPLOYED_WORKER_FORBIDDEN",
      "Local mail reply verification fixtures cannot run in a deployed Worker context",
    );
  }
}

export const LOCAL_MAIL_REPLY_VERIFY_D1_HINT =
  ".wrangler/state/v3/d1 (crm-db via getPlatformProxy, local only)";
