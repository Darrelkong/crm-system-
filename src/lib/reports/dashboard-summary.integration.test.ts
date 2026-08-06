import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getDashboardSummary } from "./dashboard-summary";
import { getPendingActionCount } from "@/lib/notifications/queries";
import type { User } from "../../../drizzle/schema/users";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

const staffUser = {
  id: SEED_IDS.staffA,
  role: "staff",
  displayName: "Staff A",
} as User;

const adminUser = {
  id: SEED_IDS.admin,
  role: "admin",
  displayName: "Admin",
} as User;

describe("dashboard summary permissions DB", () => {
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

  it("returns staff-scoped summary without team member counts", async () => {
    const summary = await getDashboardSummary(db, staffUser);
    assert.equal(summary.role, "staff");
    assert.equal(summary.reclamationRisk.memberCount, null);
    assert.equal(summary.reclamationRisk.drilldownHref, "/customers?reclamationRisk=mine");
    assert.equal(typeof summary.metrics.myCustomerCount, "number");
    assert.equal(typeof summary.metrics.pendingWorkItems, "number");
  });

  it("returns admin team summary with member count field", async () => {
    const summary = await getDashboardSummary(db, adminUser);
    assert.equal(summary.role, "admin");
    assert.equal(summary.reclamationRisk.drilldownHref, "/customers?reclamationRisk=team");
    assert.ok(summary.reclamationRisk.memberCount == null || summary.reclamationRisk.memberCount >= 0);
    assert.equal(typeof summary.metrics.totalCustomers, "number");
  });

  it("aligns staff pendingWorkItems with Phase 3 pending count", async () => {
    const summary = await getDashboardSummary(db, staffUser);
    if (summary.role !== "staff") {
      throw new Error("expected staff");
    }
    const pending = await getPendingActionCount(db, staffUser.id);
    assert.equal(summary.metrics.pendingWorkItems, pending);
  });
});
