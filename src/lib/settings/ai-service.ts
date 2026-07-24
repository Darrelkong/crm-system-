import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import {
  AI_SETTING_DEFAULTS,
  AI_SETTING_KEYS,
  isAiSettingKey,
  type AiSettingKey,
} from "@/lib/settings/ai-keys";
import { mergeAiSettings, validateAiSettingsPatch } from "@/lib/settings/ai-validation";
import type { User } from "../../../drizzle/schema/users";

export type AiSettingsMap = Record<AiSettingKey, string>;

export class AiSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSettingsError";
  }
}

export async function getAiSettings(db?: Database): Promise<AiSettingsMap> {
  const database = db ?? getDb();
  const rows = await database
    .select()
    .from(schema.systemSettings)
    .where(inArray(schema.systemSettings.key, [...AI_SETTING_KEYS]));

  const result = { ...AI_SETTING_DEFAULTS };
  for (const row of rows) {
    if (isAiSettingKey(row.key)) {
      result[row.key] = row.value;
    }
  }
  return result;
}

export async function updateAiSettings(
  actor: User,
  updates: Record<string, string>,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<AiSettingsMap> {
  const validationError = validateAiSettingsPatch(updates);
  if (validationError) {
    throw new AiSettingsError(validationError);
  }

  const db = getDb();
  const now = new Date().toISOString();
  const current = await getAiSettings(db);
  const merged = mergeAiSettings(current, updates);
  const changed: Partial<AiSettingsMap> = {};

  for (const key of AI_SETTING_KEYS) {
    const nextValue = merged[key];
    if (nextValue !== current[key]) {
      changed[key] = nextValue;
    }
  }

  for (const [key, value] of Object.entries(changed)) {
    if (!isAiSettingKey(key)) continue;

    const existing = await db
      .select({ key: schema.systemSettings.key })
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(schema.systemSettings)
        .set({ value, updatedBy: actor.id, updatedAt: now })
        .where(eq(schema.systemSettings.key, key));
    } else {
      await db.insert(schema.systemSettings).values({
        key,
        value,
        updatedBy: actor.id,
        updatedAt: now,
      });
    }
  }

  if (Object.keys(changed).length > 0) {
    const staffUsageKeys = [
      "ai_staff_deep_analysis_enabled",
      "ai_staff_daily_limit",
    ] as const;
    const before: Partial<AiSettingsMap> = {};
    const after: Partial<AiSettingsMap> = {};
    for (const key of staffUsageKeys) {
      if (key in changed) {
        before[key] = current[key];
        after[key] = changed[key];
      }
    }

    await writeAuditLog({
      userId: actor.id,
      action: "ai_settings.updated",
      entityType: "system_settings",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        changedKeys: Object.keys(changed),
        ...(Object.keys(before).length > 0 ? { before, after } : {}),
      },
    });
  }

  return getAiSettings(db);
}
