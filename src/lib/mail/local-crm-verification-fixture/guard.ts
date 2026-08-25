import { LOCAL_MAIL_CRM_VERIFY_OPT_IN_ENV } from "@/lib/mail/local-crm-verification-fixture/constants";

export class LocalMailCrmVerifyFixtureGuardError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalMailCrmVerifyFixtureGuardError";
    this.code = code;
  }
}

export type LocalMailCrmVerifyCliTarget = {
  local: boolean;
  remote: boolean;
};

export function parseLocalMailCrmVerifyCliTarget(
  argv: string[],
): LocalMailCrmVerifyCliTarget {
  return {
    local: argv.includes("--local"),
    remote: argv.includes("--remote"),
  };
}

export function assertLocalMailCrmVerifyFixtureAllowed(
  target: LocalMailCrmVerifyCliTarget = { local: false, remote: false },
): void {
  if (process.env[LOCAL_MAIL_CRM_VERIFY_OPT_IN_ENV] !== "1") {
    throw new LocalMailCrmVerifyFixtureGuardError(
      "OPT_IN_REQUIRED",
      `${LOCAL_MAIL_CRM_VERIFY_OPT_IN_ENV}=1 is required for local mail CRM verification fixtures`,
    );
  }

  if (target.remote) {
    throw new LocalMailCrmVerifyFixtureGuardError(
      "REMOTE_FORBIDDEN",
      "Remote D1 is forbidden for local mail CRM verification fixtures",
    );
  }

  if (!target.local) {
    throw new LocalMailCrmVerifyFixtureGuardError(
      "LOCAL_FLAG_REQUIRED",
      "Pass --local to target wrangler local D1 (.wrangler/state/v3/d1) only",
    );
  }

  if (process.env.CF_PAGES === "1" || process.env.CF_WORKER === "1") {
    throw new LocalMailCrmVerifyFixtureGuardError(
      "DEPLOYED_WORKER_FORBIDDEN",
      "Local mail CRM verification fixtures cannot run in a deployed Worker context",
    );
  }
}

export const LOCAL_MAIL_CRM_VERIFY_D1_HINT =
  ".wrangler/state/v3/d1 (crm-db via getPlatformProxy, local only)";
