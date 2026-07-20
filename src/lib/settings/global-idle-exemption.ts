import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

/** Public boolean setting — also listed in SETTING_KEYS for getSystemSettings. */
export const GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY =
  "global_idle_timeout_exempt_enabled" as const;

/**
 * Internal staff Access reverify epoch (Unix seconds as decimal string).
 * Not in SETTING_KEYS — never exposed via generic settings GET/PATCH.
 */
export const STAFF_ACCESS_REVERIFY_AFTER_KEY =
  "staff_access_reverify_after" as const;

export const GLOBAL_IDLE_EXEMPTION_AUDIT_ACTION =
  "system_settings.global_idle_timeout_exemption_updated" as const;

/** Canonical decimal Unix-seconds form: "0" or no leading zeros. */
const STAFF_ACCESS_REVERIFY_AFTER_PATTERN = /^(0|[1-9]\d*)$/;

export type GlobalIdlePolicy = {
  /** When true, CRM idle timeout is skipped for all roles. */
  globalIdleTimeoutExempt: boolean;
  /**
   * Unix seconds. Staff sessions with createdAtSeconds <= this value must
   * reverify Access. 0 means no epoch is active.
   */
  staffAccessReverifyAfter: number;
};

export type GlobalIdleExemptionUpdateResult = {
  enabled: boolean;
  changed: boolean;
  staffAccessReverifyAfter: number;
};

function parseExemptEnabled(raw: string | undefined): boolean {
  return raw === "true";
}

/**
 * Parses Unix-seconds epoch from a canonical decimal string.
 * Empty / invalid / unsafe → 0 (inactive). Does not use Number(raw).
 */
export function parseStaffAccessReverifyAfter(
  raw: string | undefined | null,
): number {
  if (raw == null || !STAFF_ACCESS_REVERIFY_AFTER_PATTERN.test(raw)) {
    return 0;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < 0) {
    return 0;
  }
  return n;
}

export function isoToUnixSeconds(iso: string): number | null {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) {
    return null;
  }
  return Math.floor(ms / 1000);
}

/**
 * Staff session is blocked when createdAt (unix sec) <= epoch.
 * Admin never blocked. Epoch 0 disables the check.
 */
export function isStaffSessionBlockedByReverifyEpoch(
  role: string,
  sessionCreatedAtIso: string,
  reverifyAfterUnixSec: number,
): boolean {
  if (role === "admin") {
    return false;
  }
  if (reverifyAfterUnixSec <= 0) {
    return false;
  }
  const createdSec = isoToUnixSeconds(sessionCreatedAtIso);
  if (createdSec == null) {
    return true;
  }
  return createdSec <= reverifyAfterUnixSec;
}

/**
 * Staff may create a CRM session only when Access JWT iat > epoch.
 * Admin always allowed. Epoch 0 disables. When Access check is not required
 * (local development / test), the iat gate is skipped so login cannot loop.
 *
 * `accessIat` must be a verified Access JWT claim (safe non-negative integer
 * Unix seconds). Strings, floats, negatives, and non-finite values fail closed
 * when the gate is active.
 */
export function staffAccessJwtAllowsNewSession(input: {
  role: string;
  accessCheckRequired: boolean;
  accessIat: number | null | undefined;
  reverifyAfterUnixSec: number;
}): boolean {
  if (input.role === "admin") {
    return true;
  }
  if (input.reverifyAfterUnixSec <= 0) {
    return true;
  }
  if (!input.accessCheckRequired) {
    return true;
  }
  if (
    typeof input.accessIat !== "number" ||
    !Number.isSafeInteger(input.accessIat) ||
    input.accessIat < 0
  ) {
    return false;
  }
  return input.accessIat > input.reverifyAfterUnixSec;
}

export type StaffLoginAccessEpochDecision =
  | { allowed: true }
  | {
      allowed: false;
      errorCode: "SESSION_ACCESS_REVERIFY_REQUIRED";
      error: string;
    };

/**
 * Login-time gate used after password success and before device/session writes.
 */
export function evaluateStaffLoginAccessEpochGate(input: {
  role: string;
  accessCheckRequired: boolean;
  accessIat: number | null | undefined;
  reverifyAfterUnixSec: number;
}): StaffLoginAccessEpochDecision {
  if (
    staffAccessJwtAllowsNewSession({
      role: input.role,
      accessCheckRequired: input.accessCheckRequired,
      accessIat: input.accessIat,
      reverifyAfterUnixSec: input.reverifyAfterUnixSec,
    })
  ) {
    return { allowed: true };
  }
  return {
    allowed: false,
    errorCode: "SESSION_ACCESS_REVERIFY_REQUIRED",
    error: "需要重新完成 Access 验证",
  };
}

async function readPolicyRows(db: Database): Promise<GlobalIdlePolicy> {
  const rows = await db
    .select({
      key: schema.systemSettings.key,
      value: schema.systemSettings.value,
    })
    .from(schema.systemSettings)
    .where(
      inArray(schema.systemSettings.key, [
        GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY,
        STAFF_ACCESS_REVERIFY_AFTER_KEY,
      ]),
    );

  let enabledRaw: string | undefined;
  let epochRaw: string | undefined;
  for (const row of rows) {
    if (row.key === GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY) {
      enabledRaw = row.value;
    } else if (row.key === STAFF_ACCESS_REVERIFY_AFTER_KEY) {
      epochRaw = row.value;
    }
  }

  return {
    globalIdleTimeoutExempt: parseExemptEnabled(enabledRaw),
    staffAccessReverifyAfter: parseStaffAccessReverifyAfter(epochRaw),
  };
}

/** One D1 round-trip for both keys. Defaults: exempt=false, epoch=0. */
export async function getGlobalIdlePolicy(
  db?: Database,
): Promise<GlobalIdlePolicy> {
  return readPolicyRows(db ?? getDb());
}

/** Build a Drizzle statement only — do not await (awaiting executes immediately). */
function buildUpsertSettingStatement(
  db: Database,
  key: string,
  value: string,
  actorId: string,
  now: string,
  exists: boolean,
) {
  if (exists) {
    return db
      .update(schema.systemSettings)
      .set({ value, updatedBy: actorId, updatedAt: now })
      .where(eq(schema.systemSettings.key, key));
  }
  return db.insert(schema.systemSettings).values({
    key,
    value,
    updatedBy: actorId,
    updatedAt: now,
  });
}

async function settingExists(db: Database, key: string): Promise<boolean> {
  const rows = await db
    .select({ key: schema.systemSettings.key })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  return rows.length > 0;
}

/**
 * Dedicated updater for the global idle-timeout exemption switch.
 * Only refreshes staff_access_reverify_after on true → false.
 */
export async function updateGlobalIdleTimeoutExemption(
  actor: User,
  enabled: boolean,
  meta: { ipAddress?: string | null; userAgent?: string | null },
  db?: Database,
): Promise<GlobalIdleExemptionUpdateResult> {
  const database = db ?? getDb();
  const current = await readPolicyRows(database);

  if (current.globalIdleTimeoutExempt === enabled) {
    return {
      enabled: current.globalIdleTimeoutExempt,
      changed: false,
      staffAccessReverifyAfter: current.staffAccessReverifyAfter,
    };
  }

  const now = new Date().toISOString();
  const nextValue = enabled ? "true" : "false";
  const previousEnabled = current.globalIdleTimeoutExempt;

  const exemptExists = await settingExists(
    database,
    GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY,
  );

  if (enabled) {
    // false → true: enable only; do not touch epoch.
    const auditId = crypto.randomUUID();
    await database.batch([
      buildUpsertSettingStatement(
        database,
        GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY,
        nextValue,
        actor.id,
        now,
        exemptExists,
      ),
      database.insert(schema.auditLogs).values({
        id: auditId,
        userId: actor.id,
        action: GLOBAL_IDLE_EXEMPTION_AUDIT_ACTION,
        entityType: "system_settings",
        entityId: GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        metadata: JSON.stringify({
          previousEnabled,
          enabled: true,
          requiresAccessReverification: false,
        }),
        createdAt: now,
      }),
    ] as unknown as Parameters<Database["batch"]>[0]);

    return {
      enabled: true,
      changed: true,
      staffAccessReverifyAfter: current.staffAccessReverifyAfter,
    };
  }

  // true → false: disable + set epoch atomically with audit.
  const epochSec = Math.floor(Date.now() / 1000);
  const epochValue = String(epochSec);
  const epochExists = await settingExists(
    database,
    STAFF_ACCESS_REVERIFY_AFTER_KEY,
  );
  const auditId = crypto.randomUUID();

  await database.batch([
    buildUpsertSettingStatement(
      database,
      GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY,
      nextValue,
      actor.id,
      now,
      exemptExists,
    ),
    buildUpsertSettingStatement(
      database,
      STAFF_ACCESS_REVERIFY_AFTER_KEY,
      epochValue,
      actor.id,
      now,
      epochExists,
    ),
    database.insert(schema.auditLogs).values({
      id: auditId,
      userId: actor.id,
      action: GLOBAL_IDLE_EXEMPTION_AUDIT_ACTION,
      entityType: "system_settings",
      entityId: GLOBAL_IDLE_TIMEOUT_EXEMPT_ENABLED_KEY,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      metadata: JSON.stringify({
        previousEnabled,
        enabled: false,
        staffAccessReverifyAfter: epochValue,
        requiresAccessReverification: true,
      }),
      createdAt: now,
    }),
  ] as unknown as Parameters<Database["batch"]>[0]);

  return {
    enabled: false,
    changed: true,
    staffAccessReverifyAfter: epochSec,
  };
}
