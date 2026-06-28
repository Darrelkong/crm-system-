import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  getCustomerAssigneeUserIds,
  isCustomerAssignee,
  listCustomerAssignees,
  listCustomerAssigneesByCustomerIds,
} from "./assignees";

const TEST_COLLABORATOR_ROW_ID =
  "d2a-test-collaborator-0001-0001-0001-000000000001";

describe("customer assignees helpers", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    dispose = proxy.dispose;
  });

  after(async () => {
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, TEST_COLLABORATOR_ROW_ID));
    await dispose?.();
  });

  it("returns empty list for customer with no assignees", async () => {
    const rows = await listCustomerAssignees(
      db,
      "00000000-0000-0000-0000-000000000099",
    );
    assert.deepEqual(rows, []);
  });

  it("lists backfilled primary assignee for seeded customer", async () => {
    const rows = await listCustomerAssignees(db, SEED_IDS.customerStaffA);
    assert.ok(rows.length >= 1);
    assert.equal(rows[0]?.role, "primary");
    assert.equal(rows[0]?.userId, SEED_IDS.staffA);

    const userIds = await getCustomerAssigneeUserIds(db, SEED_IDS.customerStaffA);
    assert.ok(userIds.includes(SEED_IDS.staffA));

    assert.equal(
      await isCustomerAssignee(db, SEED_IDS.customerStaffA, SEED_IDS.staffA),
      true,
    );
    assert.equal(
      await isCustomerAssignee(db, SEED_IDS.customerStaffA, SEED_IDS.staffB),
      false,
    );
  });

  it("batch loads assignees by customer ids", async () => {
    const map = await listCustomerAssigneesByCustomerIds(db, [
      SEED_IDS.customerStaffA,
      "00000000-0000-0000-0000-000000000099",
    ]);

    assert.ok((map.get(SEED_IDS.customerStaffA)?.length ?? 0) >= 1);
    assert.equal(map.has("00000000-0000-0000-0000-000000000099"), false);
  });

  it("supports additional collaborator rows", async () => {
    const now = new Date().toISOString();

    await db.insert(schema.customerAssignees).values({
      id: TEST_COLLABORATOR_ROW_ID,
      customerId: SEED_IDS.customerStaffA,
      userId: SEED_IDS.staffB,
      role: "collaborator",
      assignedBy: SEED_IDS.admin,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const rows = await listCustomerAssignees(db, SEED_IDS.customerStaffA);
    assert.ok(rows.some((row) => row.userId === SEED_IDS.staffB));
    assert.equal(
      await isCustomerAssignee(db, SEED_IDS.customerStaffA, SEED_IDS.staffB),
      true,
    );
  });

  it("does not expose customerCode or EF fields", async () => {
    const rows = await listCustomerAssignees(db, SEED_IDS.customerStaffA);
    for (const row of rows) {
      assert.equal("customerCode" in row, false);
      assert.equal("customer_code" in row, false);
    }
  });
});
