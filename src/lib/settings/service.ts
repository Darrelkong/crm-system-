import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import {
  isLockedSettingKey,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  type SettingKey,
} from "@/lib/settings/keys";
import { isSettingKey, validateSettingsPatch } from "@/lib/settings/validation";
import type { User } from "../../../drizzle/schema/users";

export type SettingsMap = Record<SettingKey, string>;

export async function getSystemSettings(db?: Database): Promise<SettingsMap> {
  const database = db ?? getDb();
  const rows = await database
    .select()
    .from(schema.systemSettings)
    .where(inArray(schema.systemSettings.key, [...SETTING_KEYS]));

  const result = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    if (isSettingKey(row.key)) {
      result[row.key] = row.value;
    }
  }
  return result;
}

export async function updateSystemSettings(
  actor: User,
  updates: Record<string, string>,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<SettingsMap> {
  const db = getDb();
  const now = new Date().toISOString();
  const changed: Partial<SettingsMap> = {};

  const current = await getSystemSettings(db);
  const consistencyError = validateSettingsPatch(current, updates);
  if (consistencyError) {
    throw new SettingsError(consistencyError);
  }

  for (const [rawKey, rawValue] of Object.entries(updates)) {
    if (isLockedSettingKey(rawKey)) {
      continue;
    }
    if (!isSettingKey(rawKey)) {
      throw new SettingsError(`未知配置项：${rawKey}`);
    }
    const value = String(rawValue).trim();

    const existing = await db
      .select({ key: schema.systemSettings.key })
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, rawKey))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(schema.systemSettings)
        .set({ value, updatedBy: actor.id, updatedAt: now })
        .where(eq(schema.systemSettings.key, rawKey));
    } else {
      await db.insert(schema.systemSettings).values({
        key: rawKey,
        value,
        updatedBy: actor.id,
        updatedAt: now,
      });
    }

    changed[rawKey] = value;
  }

  if (Object.keys(changed).length > 0) {
    await writeAuditLog({
      userId: actor.id,
      action: "system_settings.updated",
      entityType: "system_settings",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { changed },
    });
  }

  return getSystemSettings();
}

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}
