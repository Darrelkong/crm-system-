import { eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getUserById } from "@/lib/users/queries";
import { validateQuickEntryCodeFormat } from "@/lib/public-pool/quick-entry-code";
import {
  QUICK_ENTRY_ERROR_CODES,
  QUICK_ENTRY_SETTING_KEYS,
} from "@/lib/public-pool/quick-entry-constants";
import type { User } from "../../../drizzle/schema/users";

export type QuickEntryInternalSettings = {
  enabled: boolean;
  codeHash: string;
  hasCode: boolean;
  codeUpdatedAt: string | null;
  codeUpdatedBy: string | null;
  grantVersion: number;
};

export type QuickEntryAdminState = {
  enabled: boolean;
  hasCode: boolean;
  codeUpdatedAt: string | null;
  updatedBy: {
    userId: string;
    name: string;
  } | null;
};

export class QuickEntrySettingsError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "QuickEntrySettingsError";
  }
}

async function readSetting(db: Database, key: string): Promise<string> {
  const rows = await db
    .select({ value: schema.systemSettings.value })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  return rows[0]?.value ?? "";
}

async function upsertSetting(
  db: Database,
  key: string,
  value: string,
  actorId: string | null,
  now: string,
): Promise<void> {
  const existing = await db
    .select({ key: schema.systemSettings.key })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.systemSettings)
      .set({
        value,
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(eq(schema.systemSettings.key, key));
    return;
  }

  await db.insert(schema.systemSettings).values({
    key,
    value,
    updatedBy: actorId,
    updatedAt: now,
  });
}

function parseGrantVersion(raw: string): number {
  if (!raw.trim()) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

export async function getQuickEntrySettingsInternal(
  db?: Database,
): Promise<QuickEntryInternalSettings> {
  const database = db ?? getDb();
  const [enabledRaw, codeHash, codeUpdatedAt, codeUpdatedBy, grantVersionRaw] =
    await Promise.all([
      readSetting(database, QUICK_ENTRY_SETTING_KEYS.enabled),
      readSetting(database, QUICK_ENTRY_SETTING_KEYS.codeHash),
      readSetting(database, QUICK_ENTRY_SETTING_KEYS.codeUpdatedAt),
      readSetting(database, QUICK_ENTRY_SETTING_KEYS.codeUpdatedBy),
      readSetting(database, QUICK_ENTRY_SETTING_KEYS.grantVersion),
    ]);

  return {
    enabled: enabledRaw === "true",
    codeHash,
    hasCode: codeHash !== "",
    codeUpdatedAt: codeUpdatedAt || null,
    codeUpdatedBy: codeUpdatedBy || null,
    grantVersion: parseGrantVersion(grantVersionRaw),
  };
}

export async function getQuickEntryAdminState(
  db?: Database,
): Promise<QuickEntryAdminState> {
  const database = db ?? getDb();
  const internal = await getQuickEntrySettingsInternal(database);
  let updatedBy: QuickEntryAdminState["updatedBy"] = null;
  if (internal.codeUpdatedBy) {
    const user = await getUserById(internal.codeUpdatedBy);
    updatedBy = {
      userId: internal.codeUpdatedBy,
      name: user?.displayName ?? internal.codeUpdatedBy,
    };
  }
  return {
    enabled: internal.enabled,
    hasCode: internal.hasCode,
    codeUpdatedAt: internal.codeUpdatedAt,
    updatedBy,
  };
}

/**
 * Atomically increments grant_version and returns the new value.
 * Ensures the key exists (INSERT OR IGNORE at 1), then SQL-increments.
 * Concurrent bumps cannot decrease the version.
 */
export async function bumpQuickEntryGrantVersion(
  db: Database,
  actorId: string,
  now: string,
): Promise<number> {
  const key = QUICK_ENTRY_SETTING_KEYS.grantVersion;

  await db.run(sql`
    INSERT INTO system_settings (key, value, updated_by, updated_at)
    VALUES (${key}, '1', ${actorId}, ${now})
    ON CONFLICT(key) DO NOTHING
  `);

  await db
    .update(schema.systemSettings)
    .set({
      value: sql`CAST(CAST(COALESCE(${schema.systemSettings.value}, '1') AS INTEGER) + 1 AS TEXT)`,
      updatedBy: actorId,
      updatedAt: now,
    })
    .where(eq(schema.systemSettings.key, key));

  const after = await readSetting(db, key);
  return parseGrantVersion(after);
}

export async function setQuickEntryCode(
  actor: User,
  code: string,
  confirmCode: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
  db?: Database,
): Promise<QuickEntryAdminState> {
  if (code !== confirmCode) {
    throw new QuickEntrySettingsError(
      QUICK_ENTRY_ERROR_CODES.CODE_CONFIRMATION_MISMATCH,
      "录入口令确认不一致",
      400,
    );
  }

  const format = validateQuickEntryCodeFormat(code);
  if (!format.ok) {
    throw new QuickEntrySettingsError(
      format.errorCode,
      "录入口令格式不符合要求",
      400,
    );
  }

  const database = db ?? getDb();
  const before = await getQuickEntrySettingsInternal(database);
  const now = new Date().toISOString();
  const codeHash = await hashPassword(format.code);

  // Bump first so any concurrent readers see a higher version before the new
  // hash lands; never leave a new hash paired with a stale grant_version.
  await bumpQuickEntryGrantVersion(database, actor.id, now);

  const keys = [
    QUICK_ENTRY_SETTING_KEYS.codeHash,
    QUICK_ENTRY_SETTING_KEYS.codeUpdatedAt,
    QUICK_ENTRY_SETTING_KEYS.codeUpdatedBy,
  ] as const;
  const existingKeys = new Set(
    (
      await database
        .select({ key: schema.systemSettings.key })
        .from(schema.systemSettings)
        .where(inArray(schema.systemSettings.key, [...keys]))
    ).map((row) => row.key),
  );

  await database.batch([
    existingKeys.has(QUICK_ENTRY_SETTING_KEYS.codeHash)
      ? database
          .update(schema.systemSettings)
          .set({ value: codeHash, updatedBy: actor.id, updatedAt: now })
          .where(
            eq(schema.systemSettings.key, QUICK_ENTRY_SETTING_KEYS.codeHash),
          )
      : database.insert(schema.systemSettings).values({
          key: QUICK_ENTRY_SETTING_KEYS.codeHash,
          value: codeHash,
          updatedBy: actor.id,
          updatedAt: now,
        }),
    existingKeys.has(QUICK_ENTRY_SETTING_KEYS.codeUpdatedAt)
      ? database
          .update(schema.systemSettings)
          .set({ value: now, updatedBy: actor.id, updatedAt: now })
          .where(
            eq(
              schema.systemSettings.key,
              QUICK_ENTRY_SETTING_KEYS.codeUpdatedAt,
            ),
          )
      : database.insert(schema.systemSettings).values({
          key: QUICK_ENTRY_SETTING_KEYS.codeUpdatedAt,
          value: now,
          updatedBy: actor.id,
          updatedAt: now,
        }),
    existingKeys.has(QUICK_ENTRY_SETTING_KEYS.codeUpdatedBy)
      ? database
          .update(schema.systemSettings)
          .set({ value: actor.id, updatedBy: actor.id, updatedAt: now })
          .where(
            eq(
              schema.systemSettings.key,
              QUICK_ENTRY_SETTING_KEYS.codeUpdatedBy,
            ),
          )
      : database.insert(schema.systemSettings).values({
          key: QUICK_ENTRY_SETTING_KEYS.codeUpdatedBy,
          value: actor.id,
          updatedBy: actor.id,
          updatedAt: now,
        }),
  ] as unknown as Parameters<Database["batch"]>[0]);

  await writeAuditLog({
    userId: actor.id,
    action: "public_pool.quick_entry.settings_updated",
    entityType: "system_settings",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      action: "set_code",
      enabled: before.enabled,
      hadCodeBefore: before.hasCode,
      hasCodeAfter: true,
      grantVersionChanged: true,
      updatedBy: actor.id,
    },
  });

  return getQuickEntryAdminState(database);
}

export async function setQuickEntryEnabled(
  actor: User,
  enabled: boolean,
  meta: { ipAddress?: string | null; userAgent?: string | null },
  db?: Database,
): Promise<QuickEntryAdminState> {
  const database = db ?? getDb();
  const before = await getQuickEntrySettingsInternal(database);
  const now = new Date().toISOString();

  if (enabled) {
    if (!before.hasCode) {
      throw new QuickEntrySettingsError(
        QUICK_ENTRY_ERROR_CODES.CODE_NOT_CONFIGURED,
        "请先设置录入口令",
        409,
      );
    }
    await upsertSetting(
      database,
      QUICK_ENTRY_SETTING_KEYS.enabled,
      "true",
      actor.id,
      now,
    );
    await writeAuditLog({
      userId: actor.id,
      action: "public_pool.quick_entry.settings_updated",
      entityType: "system_settings",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        action: "enabled",
        enabled: true,
        hadCodeBefore: before.hasCode,
        hasCodeAfter: before.hasCode,
        grantVersionChanged: false,
        updatedBy: actor.id,
      },
    });
  } else {
    await upsertSetting(
      database,
      QUICK_ENTRY_SETTING_KEYS.enabled,
      "false",
      actor.id,
      now,
    );
    await bumpQuickEntryGrantVersion(database, actor.id, now);
    await writeAuditLog({
      userId: actor.id,
      action: "public_pool.quick_entry.settings_updated",
      entityType: "system_settings",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        action: "disabled",
        enabled: false,
        hadCodeBefore: before.hasCode,
        hasCodeAfter: before.hasCode,
        grantVersionChanged: true,
        updatedBy: actor.id,
      },
    });
  }

  return getQuickEntryAdminState(database);
}
