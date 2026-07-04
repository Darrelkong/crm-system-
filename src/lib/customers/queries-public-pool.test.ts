import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  listCustomersForUserPaginated,
  searchCustomersForUserPaginated,
  listCustomerCreatorsForAdmin,
} from "./queries";
import type { User } from "../../../drizzle/schema/users";

const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;

// Stable IDs for temporary test data created within specific nested describes.
const TEMP_POOL_CREATOR_ID = "pp-test-creator-000000000001";
const TEMP_POOL_CUSTOMER_ID = "pp-test-pool-customer-000001";

describe("public pool exclusion from normal customer lists", () => {
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

  // ── Basic tests with existing seed data (no DB writes) ────────────────────

  it("staff list excludes public_pool customer", async () => {
    const result = await listCustomersForUserPaginated(staffA, {}, 1);
    const ids = result.items.map((c) => c.id);
    assert.equal(
      ids.includes(SEED_IDS.customerPublicPool),
      false,
      "customerPublicPool must not appear in staff list",
    );
  });

  it("staff list includes own active customer", async () => {
    const result = await listCustomersForUserPaginated(staffA, {}, 1);
    const ids = result.items.map((c) => c.id);
    assert.ok(
      ids.includes(SEED_IDS.customerStaffA),
      "customerStaffA must appear in staffA list",
    );
  });

  it("staff list contains no public_pool status customers", async () => {
    const result = await listCustomersForUserPaginated(staffA, {}, 1);
    const poolItems = result.items.filter((c) => c.status === "public_pool");
    assert.equal(poolItems.length, 0, "no public_pool customers in staff list");
  });

  it("staff search by pool customer name excludes that customer", async () => {
    const result = await searchCustomersForUserPaginated(
      staffA,
      "公共池测试",
      {},
      1,
    );
    const ids = result.items.map((c) => c.id);
    assert.equal(
      ids.includes(SEED_IDS.customerPublicPool),
      false,
      "staff search must not return customerPublicPool",
    );
  });

  it("staff search results contain no public_pool status customers", async () => {
    const result = await searchCustomersForUserPaginated(staffA, "测试", {}, 1);
    const poolItems = result.items.filter((c) => c.status === "public_pool");
    assert.equal(poolItems.length, 0, "staff search must not include public_pool items");
  });

  it("admin normal list excludes public_pool customer", async () => {
    const result = await listCustomersForUserPaginated(adminUser, {}, 1);
    const ids = result.items.map((c) => c.id);
    assert.equal(
      ids.includes(SEED_IDS.customerPublicPool),
      false,
      "customerPublicPool must not appear in admin normal list",
    );
  });

  it("admin normal list includes active customers", async () => {
    // Search by name to find the specific customer regardless of pagination position.
    const result = await searchCustomersForUserPaginated(
      adminUser,
      "Staff A 测试",
      {},
      1,
    );
    assert.ok(
      result.items.some((c) => c.id === SEED_IDS.customerStaffA),
      "customerStaffA must appear when admin searches for it",
    );
  });

  it("admin normal list contains no public_pool status customers", async () => {
    const result = await listCustomersForUserPaginated(adminUser, {}, 1);
    const poolItems = result.items.filter((c) => c.status === "public_pool");
    assert.equal(poolItems.length, 0, "no public_pool customers in admin normal list");
  });

  it("admin search by pool customer name returns no results", async () => {
    const result = await searchCustomersForUserPaginated(
      adminUser,
      "公共池测试",
      {},
      1,
    );
    const ids = result.items.map((c) => c.id);
    assert.equal(
      ids.includes(SEED_IDS.customerPublicPool),
      false,
      "admin search must not return customerPublicPool",
    );
  });

  it("staff paginated count excludes public_pool customer", async () => {
    const withPool = await listCustomersForUserPaginated(staffA, {}, 1);
    // Count should not include public_pool customers – assert the ID is absent
    // and no pagination.total inflation from pool customers.
    assert.equal(
      withPool.pagination.total,
      withPool.items.filter((c) => c.status !== "public_pool").length +
        (withPool.pagination.pageCount > 1
          ? withPool.pagination.total - withPool.items.length
          : 0),
      "pagination total must not exceed non-pool item count",
    );
    // Simpler sanity: customerPublicPool is not in items
    assert.equal(
      withPool.items.some((c) => c.id === SEED_IDS.customerPublicPool),
      false,
    );
  });

  // ── Edge case: public_pool customer retains ownerId ───────────────────────
  // This should never happen in normal flows, but the fix must be robust.
  describe("edge case: public_pool customer with ownerId still set", () => {
    before(async () => {
      await db
        .update(schema.customers)
        .set({ ownerId: SEED_IDS.staffA })
        .where(
          and(
            eq(schema.customers.id, SEED_IDS.customerPublicPool),
            eq(schema.customers.status, "public_pool"),
          ),
        );
    });

    after(async () => {
      await db
        .update(schema.customers)
        .set({ ownerId: null })
        .where(eq(schema.customers.id, SEED_IDS.customerPublicPool));
    });

    it("staff list excludes public_pool customer even when ownerId = staff.id", async () => {
      const result = await listCustomersForUserPaginated(staffA, {}, 1);
      const ids = result.items.map((c) => c.id);
      assert.equal(
        ids.includes(SEED_IDS.customerPublicPool),
        false,
        "status=public_pool must take priority over ownerId match",
      );
    });

    it("admin list excludes public_pool customer even when ownerId is set", async () => {
      const result = await listCustomersForUserPaginated(adminUser, {}, 1);
      const ids = result.items.map((c) => c.id);
      assert.equal(
        ids.includes(SEED_IDS.customerPublicPool),
        false,
        "admin list must also exclude public_pool with ownerId set",
      );
    });
  });

  // ── Edge case: staff is assignee of a public_pool customer ────────────────
  describe("edge case: staff is assignee of a public_pool customer", () => {
    const TEMP_ASSIGNEE_ROW_ID = "pp-test-assignee-row-000000000001";

    before(async () => {
      const now = new Date().toISOString();
      await db
        .delete(schema.customerAssignees)
        .where(eq(schema.customerAssignees.id, TEMP_ASSIGNEE_ROW_ID));
      await db.insert(schema.customerAssignees).values({
        id: TEMP_ASSIGNEE_ROW_ID,
        customerId: SEED_IDS.customerPublicPool,
        userId: SEED_IDS.staffA,
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
        .where(eq(schema.customerAssignees.id, TEMP_ASSIGNEE_ROW_ID));
    });

    it("staff list excludes public_pool customer even when staff is assignee", async () => {
      const result = await listCustomersForUserPaginated(staffA, {}, 1);
      const ids = result.items.map((c) => c.id);
      assert.equal(
        ids.includes(SEED_IDS.customerPublicPool),
        false,
        "status=public_pool must take priority over assignee match",
      );
    });

    it("staff search excludes public_pool customer even when staff is assignee", async () => {
      const result = await searchCustomersForUserPaginated(
        staffA,
        "公共池",
        {},
        1,
      );
      const ids = result.items.map((c) => c.id);
      assert.equal(
        ids.includes(SEED_IDS.customerPublicPool),
        false,
        "staff search must also exclude public_pool assignee customer",
      );
    });
  });

  // ── Claim simulation: customer reappears after status→active ──────────────
  describe("claim simulation: customer reappears after claim", () => {
    before(async () => {
      const now = new Date().toISOString();
      await db
        .update(schema.customers)
        .set({
          ownerId: SEED_IDS.staffA,
          status: "active",
          claimedBy: SEED_IDS.staffA,
          claimedAt: now,
          poolLeftAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.customers.id, SEED_IDS.customerPublicPool),
            eq(schema.customers.status, "public_pool"),
            isNull(schema.customers.ownerId),
          ),
        );
    });

    after(async () => {
      const now = new Date().toISOString();
      await db
        .update(schema.customers)
        .set({
          ownerId: null,
          status: "public_pool",
          claimedBy: null,
          claimedAt: null,
          poolLeftAt: null,
          updatedAt: now,
        })
        .where(eq(schema.customers.id, SEED_IDS.customerPublicPool));
    });

    it("staff list includes customer after claim (status=active, ownerId=staff)", async () => {
      const result = await listCustomersForUserPaginated(staffA, {}, 1);
      const ids = result.items.map((c) => c.id);
      assert.ok(
        ids.includes(SEED_IDS.customerPublicPool),
        "after claim customer must appear in staff list",
      );
    });

    it("admin list includes customer after claim", async () => {
      // Search by name to find the specific customer regardless of pagination position.
      const result = await searchCustomersForUserPaginated(
        adminUser,
        "公共池测试",
        {},
        1,
      );
      assert.ok(
        result.items.some((c) => c.id === SEED_IDS.customerPublicPool),
        "after claim customer must appear when admin searches for it",
      );
    });
  });

  // ── Creator dropdown: listCustomerCreatorsForAdmin ────────────────────────
  describe("creator dropdown excludes creator of public_pool-only customer", () => {
    before(async () => {
      const now = new Date().toISOString();
      // Insert a test user whose ONLY customer will be public_pool
      await db.delete(schema.customers).where(
        eq(schema.customers.id, TEMP_POOL_CUSTOMER_ID),
      );
      await db.delete(schema.users).where(
        eq(schema.users.id, TEMP_POOL_CREATOR_ID),
      );
      await db.insert(schema.users).values({
        id: TEMP_POOL_CREATOR_ID,
        email: "pp-test-creator@crm.test",
        displayName: "PP Test Creator",
        passwordHash: "INVALID_HASH_TEST_ONLY",
        role: "staff",
        isActive: 1,
        failedLoginAttempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.customers).values({
        id: TEMP_POOL_CUSTOMER_ID,
        customerName: "PP Test Pool-Only Customer",
        source: "other",
        status: "public_pool",
        ownerId: null,
        poolEnteredAt: now,
        poolReason: "test: creator dropdown exclusion",
        releasedBy: TEMP_POOL_CREATOR_ID,
        createdBy: TEMP_POOL_CREATOR_ID,
        updatedBy: TEMP_POOL_CREATOR_ID,
        createdAt: now,
        updatedAt: now,
      });
    });

    after(async () => {
      await db.delete(schema.customers).where(
        eq(schema.customers.id, TEMP_POOL_CUSTOMER_ID),
      );
      await db.delete(schema.users).where(
        eq(schema.users.id, TEMP_POOL_CREATOR_ID),
      );
    });

    it("creator dropdown does not include creator whose only customers are public_pool", async () => {
      const creators = await listCustomerCreatorsForAdmin({});
      const creatorIds = creators.map((c) => c.id);
      assert.equal(
        creatorIds.includes(TEMP_POOL_CREATOR_ID),
        false,
        "public_pool-only creator must not appear in admin creator dropdown",
      );
    });

    it("creator dropdown still includes creators of active customers", async () => {
      const creators = await listCustomerCreatorsForAdmin({});
      const creatorIds = creators.map((c) => c.id);
      assert.ok(
        creatorIds.includes(SEED_IDS.staffA),
        "staffA (creator of active customer) must still appear in dropdown",
      );
    });
  });
});
