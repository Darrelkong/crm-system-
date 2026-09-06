import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { recordFirstSuccessfulCrmLogin } from "./first-login";

describe("first successful CRM login", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;
  let original: {
    firstLoginAt: string | null;
    updatedAt: string;
  };

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    original = (
      await db
        .select({
          firstLoginAt: schema.users.firstLoginAt,
          updatedAt: schema.users.updatedAt,
        })
        .from(schema.users)
        .where(eq(schema.users.id, SEED_IDS.staffA))
        .limit(1)
    )[0]!;
  });

  after(async () => {
    await db
      .update(schema.users)
      .set(original)
      .where(eq(schema.users.id, SEED_IDS.staffA));
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("sets once and ignores later successful logins", async () => {
    await db
      .update(schema.users)
      .set({ firstLoginAt: null })
      .where(eq(schema.users.id, SEED_IDS.staffA));

    const first = "2026-01-01T00:00:00.000Z";
    const second = "2026-02-01T00:00:00.000Z";
    assert.equal(
      await recordFirstSuccessfulCrmLogin(db, SEED_IDS.staffA, first),
      true,
    );
    assert.equal(
      await recordFirstSuccessfulCrmLogin(db, SEED_IDS.staffA, second),
      false,
    );

    const row = (
      await db
        .select({ firstLoginAt: schema.users.firstLoginAt })
        .from(schema.users)
        .where(eq(schema.users.id, SEED_IDS.staffA))
        .limit(1)
    )[0]!;
    assert.equal(row.firstLoginAt, first);
  });
});
