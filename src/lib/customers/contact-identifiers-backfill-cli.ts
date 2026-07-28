/**
 * CLI argument gates for customer_contact_identifiers backfill.
 * Pure validation — no DB I/O. Safe to unit-test without D1.
 *
 * Official production order (DO NOT reverse):
 * 1. Production D1 backup
 * 2. remote apply migration 0041
 * 3. Verify 0041 schema
 * 4. push / deploy Phase 2A dual-write app
 * 5. Verify new create/edit paths sync identifiers (queries / natural ops only;
 *    do not create dedicated production test customers)
 * 6. Production backfill dry-run
 * 7. dry-run conflicts must be 0
 * 8. Production backfill apply (confirm token required)
 * 9. Coverage verification (missing/extra/mismatch/conflicts = 0)
 * 10. Re-run dry-run → planned insert/delete = 0
 * 11. Re-run cross-customer Phone/WeChat/Email conflict scan
 * 12. Only then design / apply 0042 global unique
 *
 * Forbidden order: 0041 → backfill → deploy
 * (writes between backfill and deploy would miss identifiers)
 */

export const REQUIRED_DATABASE_NAME = "crm-db" as const;

export const PRODUCTION_BACKFILL_CONFIRM =
  "BACKFILL_CUSTOMER_CONTACT_IDENTIFIERS_PRODUCTION" as const;

export type BackfillCliTarget = "local" | "remote";
export type BackfillCliMode = "dry-run" | "apply";

export type BackfillCliArgs = {
  hasLocal: boolean;
  hasRemote: boolean;
  apply: boolean;
  database: string | null;
  confirm: string | null;
  /** Forbidden flags present in argv (fail-closed). */
  forbiddenFlags: string[];
};

export type BackfillCliOk = {
  ok: true;
  target: BackfillCliTarget;
  mode: BackfillCliMode;
  database: typeof REQUIRED_DATABASE_NAME;
  rowsWritten: 0;
};

export type BackfillCliRejected = {
  ok: false;
  code: string;
  message: string;
  rowsWritten: 0;
};

export type BackfillCliDecision = BackfillCliOk | BackfillCliRejected;

const FORBIDDEN_FLAGS = [
  "--force",
  "--skip-conflicts",
  "--skip-conflict",
  "--auto-merge",
  "--auto-delete",
] as const;

export function parseBackfillCliArgs(argv: string[]): BackfillCliArgs {
  let database: string | null = null;
  let confirm: string | null = null;
  const forbiddenFlags: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if ((FORBIDDEN_FLAGS as readonly string[]).includes(arg)) {
      forbiddenFlags.push(arg);
      continue;
    }
    if (arg === "--database") {
      database = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith("--database=")) {
      database = arg.slice("--database=".length) || null;
    } else if (arg === "--confirm") {
      confirm = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith("--confirm=")) {
      confirm = arg.slice("--confirm=".length) || null;
    }
  }

  return {
    hasLocal: argv.includes("--local"),
    hasRemote: argv.includes("--remote"),
    apply: argv.includes("--apply"),
    database,
    confirm,
    forbiddenFlags,
  };
}

/**
 * Resolve CLI intent with fail-closed gates.
 * Default (no target flags): local dry-run.
 */
export function resolveBackfillCliDecision(
  args: BackfillCliArgs,
): BackfillCliDecision {
  if (args.forbiddenFlags.length > 0) {
    return reject(
      "FORCE_FORBIDDEN",
      `Forbidden flag(s): ${args.forbiddenFlags.join(", ")}. No force / skip-conflict / auto-merge options.`,
    );
  }

  if (args.hasLocal && args.hasRemote) {
    return reject(
      "TARGET_AMBIGUOUS",
      "Pass at most one of --local or --remote (default is local dry-run).",
    );
  }

  const target: BackfillCliTarget = args.hasRemote ? "remote" : "local";

  if (target === "local") {
    if (args.database != null && args.database !== REQUIRED_DATABASE_NAME) {
      return reject(
        "DATABASE_NOT_ALLOWED",
        `Database must be ${REQUIRED_DATABASE_NAME} when specified (got ${args.database}).`,
      );
    }
    if (args.apply) {
      if (!args.hasLocal) {
        return reject(
          "APPLY_REQUIRES_TARGET",
          "Local apply requires --local --apply (bare --apply is refused).",
        );
      }
      return {
        ok: true,
        target: "local",
        mode: "apply",
        database: REQUIRED_DATABASE_NAME,
        rowsWritten: 0,
      };
    }
    return {
      ok: true,
      target: "local",
      mode: "dry-run",
      database: REQUIRED_DATABASE_NAME,
      rowsWritten: 0,
    };
  }

  // Remote — database name is mandatory and must be crm-db.
  if (args.database == null) {
    return reject(
      "DATABASE_REQUIRED",
      `Remote backfill requires --database=${REQUIRED_DATABASE_NAME}.`,
    );
  }
  if (args.database !== REQUIRED_DATABASE_NAME) {
    return reject(
      "DATABASE_NOT_ALLOWED",
      `Remote database must be ${REQUIRED_DATABASE_NAME} (got ${args.database}).`,
    );
  }

  if (!args.apply) {
    return {
      ok: true,
      target: "remote",
      mode: "dry-run",
      database: REQUIRED_DATABASE_NAME,
      rowsWritten: 0,
    };
  }

  if (args.confirm !== PRODUCTION_BACKFILL_CONFIRM) {
    return reject(
      "CONFIRM_REQUIRED",
      `Remote apply requires --confirm=${PRODUCTION_BACKFILL_CONFIRM}`,
    );
  }

  return {
    ok: true,
    target: "remote",
    mode: "apply",
    database: REQUIRED_DATABASE_NAME,
    rowsWritten: 0,
  };
}

function reject(code: string, message: string): BackfillCliRejected {
  return { ok: false, code, message, rowsWritten: 0 };
}

/**
 * Convenience for tests / callers with raw argv.
 */
export function decideBackfillCli(argv: string[]): BackfillCliDecision {
  return resolveBackfillCliDecision(parseBackfillCliArgs(argv));
}
