import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { checkCustomerDuplicates } from "./duplicate-check";
import type { User } from "../../../drizzle/schema/users";

const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

// Seed contact values (scripts/seed.ts).
const STAFF_A_CUSTOMER_PHONE = "13800000001";
const STAFF_A_CUSTOMER_EMAIL = "staff-a-customer@example.com";
const POOL_CUSTOMER_PHONE = "13800000003";
const POOL_CUSTOMER_WECHAT = "pool_wechat";
const POOL_CUSTOMER_EMAIL = "pool-customer@example.com";

// Temp rows created/removed within this suite.
const TEMP_ARCHIVED_CUSTOMER_ID = "dupchk-test-archived-000000000001";
const TEMP_ARCHIVED_PHONE = "19900000009";
const TEMP_COLLAB_ROW_ID = "dupchk-test-collab-0000-0000-000000000001";
// Dedicated customer for excludeId test with a phone that is unique across seed data.
const TEMP_EXCLUDE_CUSTOMER_ID = "dupchk-test-exclude-000000000001";
const TEMP_EXCLUDE_PHONE = "19900000021";
// Two customers sharing a phone unique to this suite, to prove excludeId removes
// only the edited customer and does not wrongly exclude other real duplicates.
const TEMP_DUP_A_ID = "dupchk-test-dup-a-00000000000001";
const TEMP_DUP_B_ID = "dupchk-test-dup-b-00000000000001";
const TEMP_DUP_PHONE = "19900000022";

describe("checkCustomerDuplicates masking contract", () => {
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
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, TEMP_COLLAB_ROW_ID));
    for (const id of [
      TEMP_ARCHIVED_CUSTOMER_ID,
      TEMP_EXCLUDE_CUSTOMER_ID,
      TEMP_DUP_A_ID,
      TEMP_DUP_B_ID,
    ]) {
      await db.delete(schema.customers).where(eq(schema.customers.id, id));
    }
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("admin sees full duplicate detail", async () => {
    const matches = await checkCustomerDuplicates(
      { phone: STAFF_A_CUSTOMER_PHONE },
      adminUser,
    );
    const match = matches.find((m) => m.field === "phone");
    assert.ok(match, "expected a phone duplicate match");
    assert.equal(match.customer.isMasked, false);
    if (!match.customer.isMasked) {
      assert.equal(match.customer.id, SEED_IDS.customerStaffA);
      assert.equal(match.customer.customerName, "Staff A 测试客户");
      assert.equal(match.customer.status, "active");
      assert.equal(match.customer.phone, STAFF_A_CUSTOMER_PHONE);
    }
  });

  it("owner staff sees full duplicate detail", async () => {
    const matches = await checkCustomerDuplicates(
      { phone: STAFF_A_CUSTOMER_PHONE },
      staffA,
    );
    const match = matches.find((m) => m.field === "phone");
    assert.ok(match);
    assert.equal(match.customer.isMasked, false);
    if (!match.customer.isMasked) {
      assert.equal(match.customer.id, SEED_IDS.customerStaffA);
    }
  });

  it("assignee collaborator staff sees full duplicate detail", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.customerAssignees).values({
      id: TEMP_COLLAB_ROW_ID,
      customerId: SEED_IDS.customerStaffA,
      userId: SEED_IDS.staffB,
      role: "collaborator",
      assignedBy: SEED_IDS.admin,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const matches = await checkCustomerDuplicates(
        { phone: STAFF_A_CUSTOMER_PHONE },
        staffB,
      );
      const match = matches.find((m) => m.field === "phone");
      assert.ok(match);
      assert.equal(match.customer.isMasked, false);
      if (!match.customer.isMasked) {
        assert.equal(match.customer.id, SEED_IDS.customerStaffA);
      }
    } finally {
      await db
        .delete(schema.customerAssignees)
        .where(eq(schema.customerAssignees.id, TEMP_COLLAB_ROW_ID));
    }
  });

  it("other staff gets opaque masked match for a customer owned by someone else", async () => {
    const matches = await checkCustomerDuplicates(
      { phone: STAFF_A_CUSTOMER_PHONE },
      staffB,
    );
    const match = matches.find((m) => m.field === "phone");
    assert.ok(match);
    assert.equal(match.customer.isMasked, true);
    assert.deepEqual(Object.keys(match.customer), ["isMasked"]);
  });

  it("staff gets opaque masked match for a public pool customer", async () => {
    const matches = await checkCustomerDuplicates(
      { phone: POOL_CUSTOMER_PHONE },
      staffA,
    );
    const match = matches.find((m) => m.field === "phone");
    assert.ok(match);
    assert.equal(match.customer.isMasked, true);
    assert.deepEqual(Object.keys(match.customer), ["isMasked"]);
  });

  it("masked match JSON exposes no customer-identifying data", async () => {
    const matches = await checkCustomerDuplicates(
      {
        phone: POOL_CUSTOMER_PHONE,
        wechatId: POOL_CUSTOMER_WECHAT,
        email: POOL_CUSTOMER_EMAIL,
      },
      staffB,
    );
    assert.ok(matches.length > 0, "expected at least one masked match");
    for (const match of matches) {
      assert.equal(match.customer.isMasked, true);
    }

    const json = JSON.stringify(matches);
    for (const forbidden of [
      "customerName",
      "公共池测试客户",
      "status",
      "public_pool",
      SEED_IDS.customerPublicPool,
      POOL_CUSTOMER_PHONE,
      POOL_CUSTOMER_WECHAT,
      POOL_CUSTOMER_EMAIL,
      "ownerId",
      "owner_id",
    ]) {
      assert.ok(
        !json.includes(forbidden),
        `masked JSON must not contain "${forbidden}"`,
      );
    }
  });

  it("ignores archived customers", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.customers).values({
      id: TEMP_ARCHIVED_CUSTOMER_ID,
      customerName: "Archived Temp Customer",
      phone: TEMP_ARCHIVED_PHONE,
      source: "other",
      status: "archived",
      ownerId: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      createdAt: now,
      updatedAt: now,
    });

    const matches = await checkCustomerDuplicates(
      { phone: TEMP_ARCHIVED_PHONE },
      adminUser,
    );
    assert.deepEqual(matches, []);
  });

  it("excludes the edited customer via excludeId when it is the only match", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.customers).values({
      id: TEMP_EXCLUDE_CUSTOMER_ID,
      customerName: "Exclude Solo Temp Customer",
      phone: TEMP_EXCLUDE_PHONE,
      source: "other",
      status: "active",
      ownerId: SEED_IDS.admin,
      createdBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });

    try {
      // Sanity: without excludeId the dedicated unique customer is a duplicate.
      const withoutExclude = await checkCustomerDuplicates(
        { phone: TEMP_EXCLUDE_PHONE },
        adminUser,
      );
      const soloMatch = withoutExclude.find((m) => m.field === "phone");
      assert.ok(soloMatch, "expected the dedicated customer to match on phone");
      if (soloMatch && !soloMatch.customer.isMasked) {
        assert.equal(soloMatch.customer.id, TEMP_EXCLUDE_CUSTOMER_ID);
      }

      // With excludeId of that same customer (its unique phone), expect [].
      const matches = await checkCustomerDuplicates(
        { phone: TEMP_EXCLUDE_PHONE },
        adminUser,
        TEMP_EXCLUDE_CUSTOMER_ID,
      );
      assert.deepEqual(matches, []);
    } finally {
      await db
        .delete(schema.customers)
        .where(eq(schema.customers.id, TEMP_EXCLUDE_CUSTOMER_ID));
    }
  });

  it("excludeId removes only the edited customer, not other real duplicates", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.customers).values([
      {
        id: TEMP_DUP_A_ID,
        customerName: "Exclude Pair Temp A",
        phone: TEMP_DUP_PHONE,
        source: "other",
        status: "active",
        ownerId: SEED_IDS.admin,
        createdBy: SEED_IDS.admin,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: TEMP_DUP_B_ID,
        customerName: "Exclude Pair Temp B",
        phone: TEMP_DUP_PHONE,
        source: "other",
        status: "active",
        ownerId: SEED_IDS.admin,
        createdBy: SEED_IDS.admin,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    try {
      const matches = await checkCustomerDuplicates(
        { phone: TEMP_DUP_PHONE },
        adminUser,
        TEMP_DUP_A_ID,
      );

      const phoneMatches = matches.filter((m) => m.field === "phone");
      const matchedIds = phoneMatches.map((m) =>
        !m.customer.isMasked ? m.customer.id : null,
      );

      // The excluded (edited) customer must never appear.
      assert.ok(
        !matchedIds.includes(TEMP_DUP_A_ID),
        "excludeId customer must not appear in results",
      );
      // The other genuine duplicate must still be reported.
      assert.ok(
        matchedIds.includes(TEMP_DUP_B_ID),
        "other real duplicate must not be wrongly excluded",
      );
    } finally {
      for (const id of [TEMP_DUP_A_ID, TEMP_DUP_B_ID]) {
        await db.delete(schema.customers).where(eq(schema.customers.id, id));
      }
    }
  });

  it("normalizes email with trim + lowercase", async () => {
    const matches = await checkCustomerDuplicates(
      { email: `  ${STAFF_A_CUSTOMER_EMAIL.toUpperCase()}  ` },
      adminUser,
    );
    const match = matches.find((m) => m.field === "email");
    assert.ok(match, "expected email duplicate after normalization");
    assert.equal(match.customer.isMasked, false);
  });

  it("returns empty array when there is no duplicate", async () => {
    const matches = await checkCustomerDuplicates(
      { phone: "10000000000" },
      adminUser,
    );
    assert.deepEqual(matches, []);
  });
});
