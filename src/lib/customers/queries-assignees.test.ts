import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  listCustomersForUserPaginated,
  searchCustomersForUserPaginated,
} from "./queries";
import { getCustomersWithScores } from "./scoring/service";
import { getAssigneeCustomerIdsForUser } from "./assignees";
import { getEffectiveSettings } from "@/lib/settings/effective";
import type { User } from "../../../drizzle/schema/users";

const TEST_COLLABORATOR_ROW_ID =
  "d2c-test-collaborator-0001-0001-0001-000000000001";

const staffB = {
  id: SEED_IDS.staffB,
  role: "staff",
} as User;

describe("staff list/search assignee permissions", () => {
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

    const now = new Date().toISOString();
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, TEST_COLLABORATOR_ROW_ID));
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
  });

  after(async () => {
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, TEST_COLLABORATOR_ROW_ID));
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("includes assigned customer in staff B paginated list", async () => {
    const result = await listCustomersForUserPaginated(staffB, {}, 1);
    const ids = result.items.map((item) => item.id);
    assert.ok(ids.includes(SEED_IDS.customerStaffA));
  });

  it("excludes assigned customer from unrelated staff list", async () => {
    const unrelatedStaff = {
      id: "11111111-1111-1111-1111-111111111199",
      role: "staff",
    } as User;
    const result = await listCustomersForUserPaginated(unrelatedStaff, {}, 1);
    const ids = result.items.map((item) => item.id);
    assert.equal(ids.includes(SEED_IDS.customerStaffA), false);
  });

  it("lets staff B search assigned customer by name", async () => {
    const result = await searchCustomersForUserPaginated(
      staffB,
      "Staff A 测试",
      {},
      1,
    );
    assert.ok(
      result.items.some((item) => item.id === SEED_IDS.customerStaffA),
    );
  });

  it("formats assigned customer as full access without EF for staff B", async () => {
    const result = await listCustomersForUserPaginated(staffB, {}, 1);
    const customer = result.items.find(
      (item) => item.id === SEED_IDS.customerStaffA,
    );
    assert.ok(customer);

    const settings = await getEffectiveSettings(db);
    const assigneeIds = await getAssigneeCustomerIdsForUser(db, staffB.id, [
      customer!.id,
    ]);
    const [view] = getCustomersWithScores(
      staffB,
      [customer!],
      new Set(),
      settings,
      new Date(),
      assigneeIds,
    );

    assert.equal(view.accessLevel, "full");
    assert.equal("customerCode" in view, false);
  });

  it("does not duplicate rows when staff is assignee", async () => {
    const result = await listCustomersForUserPaginated(staffB, {}, 1);
    const matches = result.items.filter(
      (item) => item.id === SEED_IDS.customerStaffA,
    );
    assert.equal(matches.length, 1);
    assert.ok(result.pagination.total >= 1);
  });

  it("still excludes staff A owned customer from unrelated staff search", async () => {
    const unrelatedStaff = {
      id: "11111111-1111-1111-1111-111111111198",
      role: "staff",
    } as User;
    const result = await searchCustomersForUserPaginated(
      unrelatedStaff,
      "Staff A 测试",
      {},
      1,
    );
    assert.equal(
      result.items.some((item) => item.id === SEED_IDS.customerStaffA),
      false,
    );
  });
});
