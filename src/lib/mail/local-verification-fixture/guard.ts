import { LOCAL_MAIL_VERIFY_OPT_IN_ENV } from "@/lib/mail/local-verification-fixture/constants";

export class LocalMailVerifyFixtureGuardError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalMailVerifyFixtureGuardError";
    this.code = code;
  }
}

export type LocalMailVerifyCliTarget = {
  local: boolean;
  remote: boolean;
};

export function parseLocalMailVerifyCliTarget(argv: string[]): LocalMailVerifyCliTarget {
  return {
    local: argv.includes("--local"),
    remote: argv.includes("--remote"),
  };
}

export function assertLocalMailVerifyFixtureAllowed(
  target: LocalMailVerifyCliTarget = { local: false, remote: false },
): void {
  if (process.env[LOCAL_MAIL_VERIFY_OPT_IN_ENV] !== "1") {
    throw new LocalMailVerifyFixtureGuardError(
      "OPT_IN_REQUIRED",
      `${LOCAL_MAIL_VERIFY_OPT_IN_ENV}=1 is required for local mail verification fixtures`,
    );
  }

  if (target.remote) {
    throw new LocalMailVerifyFixtureGuardError(
      "REMOTE_FORBIDDEN",
      "Remote D1 is forbidden for local mail verification fixtures",
    );
  }

  if (!target.local) {
    throw new LocalMailVerifyFixtureGuardError(
      "LOCAL_FLAG_REQUIRED",
      "Pass --local to target wrangler local D1 (.wrangler/state/v3/d1) only",
    );
  }

  if (process.env.CF_PAGES === "1" || process.env.CF_WORKER === "1") {
    throw new LocalMailVerifyFixtureGuardError(
      "DEPLOYED_WORKER_FORBIDDEN",
      "Local mail verification fixtures cannot run in a deployed Worker context",
    );
  }
}

export const LOCAL_MAIL_VERIFY_D1_HINT =
  ".wrangler/state/v3/d1 (crm-db via getPlatformProxy, local only)";
