import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { buildStaffAiContext } from "./context/staff-context";
import { buildAdminAiContext } from "./context/admin-context";
import { serializeDashboardAiContext } from "./prompt";
import type { User } from "../../../../drizzle/schema/users";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

const staff = {
  id: SEED_IDS.staffA,
  role: "staff",
  displayName: "Staff A",
} as User;

const admin = {
  id: SEED_IDS.admin,
  role: "admin",
  displayName: "Admin",
} as User;

describe("dashboard AI context DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
  });

  after(async () => {
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("builds staff context without customer names in provider payload", async () => {
    const bundle = await buildStaffAiContext(db, staff, new Date());
    const payload = serializeDashboardAiContext(bundle.providerContext);
    assert.match(payload, /"myCustomerCount"/);
    assert.doesNotMatch(payload, /customerName/i);
    assert.doesNotMatch(payload, /phone/i);
    assert.doesNotMatch(payload, /"email"/i);
    for (const customer of bundle.providerContext.customers) {
      assert.match(customer.ref, /^C\d+$/);
    }
  });

  it("builds admin aggregate context without member names", async () => {
    const { providerContext } = await buildAdminAiContext(db, admin, new Date());
    const payload = serializeDashboardAiContext(providerContext);
    assert.match(payload, /"teamAggregates"/);
    assert.doesNotMatch(payload, /displayName/i);
    assert.doesNotMatch(payload, /"email"/i);
    assert.doesNotMatch(payload, /customerName/i);
  });
});
