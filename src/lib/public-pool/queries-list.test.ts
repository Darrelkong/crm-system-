import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  formatPublicPoolListForUser,
  listPublicPoolCustomers,
} from "@/lib/public-pool/queries";
import type { User } from "../../../drizzle/schema/users";

const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;
const staffUser = { id: SEED_IDS.staffA, role: "staff" } as User;

describe("public pool list query scope", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("listPublicPoolCustomers only returns status=public_pool", async () => {
    const rows = await listPublicPoolCustomers();
    assert.ok(rows.length > 0, "seed should include at least one public_pool customer");
    assert.equal(
      rows.every((row) => row.status === "public_pool"),
      true,
      "public pool list must only include public_pool status",
    );
    assert.equal(
      rows.some((row) => row.id === SEED_IDS.customerPublicPool),
      true,
    );
    assert.equal(
      rows.some((row) => row.id === SEED_IDS.customerStaffA),
      false,
      "active owned customers must not appear in public pool list",
    );
  });

  it("staff formatted list excludes sensitive keys from API items", async () => {
    const items = await formatPublicPoolListForUser(staffUser);
    const poolItem = items.find((item) => item.id === SEED_IDS.customerPublicPool);
    assert.ok(poolItem);
    assert.equal(poolItem.accessLevel, "masked");
    assert.equal("customerName" in poolItem, false);
    assert.equal("poolReason" in poolItem, false);
    assert.equal("phone" in poolItem, false);
    assert.ok(poolItem.maskedName);
    assert.ok(typeof poolItem.poolReasonPreview === "string" || poolItem.poolReasonPreview === null);
  });

  it("admin formatted list includes full customerName and poolReason", async () => {
    const items = await formatPublicPoolListForUser(adminUser);
    const poolItem = items.find((item) => item.id === SEED_IDS.customerPublicPool);
    assert.ok(poolItem);
    assert.equal(poolItem.accessLevel, "full");
    if (poolItem.accessLevel === "full") {
      assert.ok(poolItem.customerName);
      assert.ok("poolReason" in poolItem);
    }
  });
});
