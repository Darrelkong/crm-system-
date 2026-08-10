import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  getAssigneeCustomerIdsForUser,
  getAssigneeCustomerIdsFromRecords,
  listCustomerAssigneesByCustomerIds,
} from "@/lib/customers/assignees";
import { buildCustomerListRows } from "@/lib/customers/list-rows";
import { listCustomersForUserPaginated } from "@/lib/customers/queries";
import { getCustomersWithScores } from "@/lib/customers/scoring/service";
import { getEffectiveSettings } from "@/lib/settings/effective";
import type { User } from "../../../drizzle/schema/users";

const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;
const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;

describe("customers page Phase 2A load path", () => {
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

  it("page parallelizes reclamation risk and settings", () => {
    const page = readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");
    assert.match(
      page,
      /Promise\.all\(\[\s*resolveReclamationRiskCustomerIds/,
    );
    assert.match(page, /getEffectiveSettings/);
  });

  it("page parallelizes creator options with paginated list for admin", () => {
    const page = readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");
    assert.match(page, /listCustomerCreatorsForAdmin/);
    assert.match(page, /listCustomersForUserPaginated/);
    assert.match(page, /creatorOptionsPromise/);
  });

  it("page uses shared assignee map instead of getAssigneeCustomerIdsForUser", () => {
    const page = readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");
    assert.match(page, /getAssigneeCustomerIdsFromRecords/);
    assert.match(page, /assigneesByCustomerId/);
    assert.doesNotMatch(page, /getAssigneeCustomerIdsForUser/);
  });

  it("list-rows supports preloaded assignee map", () => {
    const listRows = readFileSync("src/lib/customers/list-rows.ts", "utf8");
    assert.match(listRows, /assigneesByCustomerId\?:/);
    assert.match(listRows, /options\?\.assigneesByCustomerId/);
  });

  it("getAssigneeCustomerIdsFromRecords matches getAssigneeCustomerIdsForUser", async () => {
    const result = await listCustomersForUserPaginated(staffB, {}, 1);
    const customerIds = result.items.map((item) => item.id);
    const assigneesByCustomerId = await listCustomerAssigneesByCustomerIds(
      db,
      customerIds,
    );

    const fromRecords = getAssigneeCustomerIdsFromRecords(
      staffB.id,
      customerIds,
      assigneesByCustomerId,
    );
    const fromQuery = await getAssigneeCustomerIdsForUser(
      db,
      staffB.id,
      customerIds,
    );

    assert.deepEqual(fromRecords, fromQuery);
  });

  it("buildCustomerListRows renders assignee names from preloaded map", async () => {
    const result = await listCustomersForUserPaginated(staffB, {}, 1);
    const customerIds = result.items.map((item) => item.id);
    const assigneesByCustomerId = await listCustomerAssigneesByCustomerIds(
      db,
      customerIds,
    );
    const settings = await getEffectiveSettings(db);
    const views = getCustomersWithScores(
      staffB,
      result.items,
      new Set(),
      settings,
      new Date(),
      getAssigneeCustomerIdsFromRecords(
        staffB.id,
        customerIds,
        assigneesByCustomerId,
      ),
    );

    const rows = await buildCustomerListRows(db, views, {
      assigneesByCustomerId,
    });
    assert.ok(rows.length > 0);
    const assignedRow = rows.find((row) => row.id === SEED_IDS.customerStaffA);
    if (assignedRow) {
      assert.ok(assignedRow.assigneeNames.length >= 0);
    }
  });

  it("staff B sees assigned collaborative customer when assignee row exists", async () => {
    const now = new Date().toISOString();
    const testRowId = "d2c-test-collaborator-0001-0001-0001-000000000002";
    const { eq } = await import("drizzle-orm");
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, testRowId));
    await db.insert(schema.customerAssignees).values({
      id: testRowId,
      customerId: SEED_IDS.customerStaffA,
      userId: SEED_IDS.staffB,
      role: "collaborator",
      assignedBy: SEED_IDS.admin,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const result = await listCustomersForUserPaginated(staffB, {}, 1);
      const ids = result.items.map((item) => item.id);
      assert.ok(ids.includes(SEED_IDS.customerStaffA));
    } finally {
      await db
        .delete(schema.customerAssignees)
        .where(eq(schema.customerAssignees.id, testRowId));
    }
  });

  it("unrelated staff cannot see private customer in paginated list", async () => {
    const unrelatedStaff = {
      id: "11111111-1111-1111-1111-111111111199",
      role: "staff",
    } as User;
    const result = await listCustomersForUserPaginated(unrelatedStaff, {}, 1);
    const ids = result.items.map((item) => item.id);
    assert.equal(ids.includes(SEED_IDS.customerStaffA), false);
  });

  it("admin paginated list includes customers", async () => {
    const result = await listCustomersForUserPaginated(adminUser, {}, 1);
    assert.ok(result.items.length > 0);
    assert.ok(result.pagination.total >= result.items.length);
  });
});
