import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { getDeviceAuthorizationLimit } from "@/lib/devices/queries";

const LIMIT_SETTING = "device_authorization_limit_per_user";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let originalSetting: schema.SystemSetting | undefined;

async function setRawLimit(value: string | null) {
  const existing = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, LIMIT_SETTING))
    .limit(1);

  if (value === null) {
    await db
      .delete(schema.systemSettings)
      .where(eq(schema.systemSettings.key, LIMIT_SETTING));
    return;
  }

  if (existing.length > 0) {
    await db
      .update(schema.systemSettings)
      .set({ value })
      .where(eq(schema.systemSettings.key, LIMIT_SETTING));
    return;
  }

  await db.insert(schema.systemSettings).values({
    key: LIMIT_SETTING,
    value,
    updatedAt: new Date().toISOString(),
  });
}

describe("getDeviceAuthorizationLimit", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    originalSetting = (
      await db
        .select()
        .from(schema.systemSettings)
        .where(eq(schema.systemSettings.key, LIMIT_SETTING))
        .limit(1)
    )[0];
  });

  after(async () => {
    if (originalSetting) {
      await db
        .update(schema.systemSettings)
        .set({
          value: originalSetting.value,
          updatedAt: originalSetting.updatedAt,
          updatedBy: originalSetting.updatedBy,
        })
        .where(eq(schema.systemSettings.key, LIMIT_SETTING));
    } else {
      await setRawLimit(null);
    }
    await disposeProxy?.();
  });

  it("uses a valid configured database value of 3", async () => {
    await setRawLimit("3");
    assert.equal(await getDeviceAuthorizationLimit(db), 3);
  });

  it("uses the canonical fallback of 3 when the setting is missing", async () => {
    await setRawLimit(null);
    assert.equal(await getDeviceAuthorizationLimit(db), 3);
  });

  it("uses the canonical fallback of 3 when the setting is invalid", async () => {
    await setRawLimit("not-an-integer");
    assert.equal(await getDeviceAuthorizationLimit(db), 3);
  });

  it("respects another valid configured limit", async () => {
    await setRawLimit("5");
    assert.equal(await getDeviceAuthorizationLimit(db), 5);
  });
});
