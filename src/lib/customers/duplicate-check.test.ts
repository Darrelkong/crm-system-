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

const STAFF_A_CUSTOMER_PHONE = "13800000001";
const STAFF_A_CUSTOMER_EMAIL = "staff-a-customer@example.com";
const POOL_CUSTOMER_PHONE = "13800000003";
const POOL_CUSTOMER_WECHAT = "pool_wechat";
const POOL_CUSTOMER_EMAIL = "pool-customer@example.com";

const TEMP_ARCHIVED_CUSTOMER_ID = "dupchk-test-archived-000000000001";
const TEMP_ARCHIVED_PHONE = "19900000009";
const TEMP_COLLAB_ROW_ID = "dupchk-test-collab-0000-0000-000000000001";
const TEMP_EXCLUDE_CUSTOMER_ID = "dupchk-test-exclude-000000000001";
const TEMP_EXCLUDE_PHONE = "19900000021";
const TEMP_DUP_A_ID = "dupchk-test-dup-a-00000000000001";
const TEMP_DUP_B_ID = "dupchk-test-dup-b-00000000000001";
const TEMP_DUP_PHONE = "19900000022";
const TEMP_CONTACT_CUSTOMER_ID = "dupchk-test-contact-cust-00000001";
const TEMP_CONTACT_ID = "dupchk-test-contact-row-00000001";
const TEMP_CONTACT_PHONE = "19900000031";
const TEMP_CONTACT_WECHAT = "DupContact_Wx";
const TEMP_CONTACT_EMAIL = "Dup.Contact@Example.com";

describe("checkCustomerDuplicates masking and harden contracts", () => {
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
    await db
      .delete(schema.customerContacts)
      .where(eq(schema.customerContacts.id, TEMP_CONTACT_ID));
    for (const id of [
      TEMP_ARCHIVED_CUSTOMER_ID,
      TEMP_EXCLUDE_CUSTOMER_ID,
      TEMP_DUP_A_ID,
      TEMP_DUP_B_ID,
      TEMP_CONTACT_CUSTOMER_ID,
    ]) {
      await db.delete(schema.customers).where(eq(schema.customers.id, id));
    }
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("admin sees authorized duplicate fields only (no raw contacts)", async () => {
    const matches = await checkCustomerDuplicates(
      { phoneCountryCode: "+86", phone: STAFF_A_CUSTOMER_PHONE },
      adminUser,
    );
    const match = matches.find((m) => m.field === "phone");
    assert.ok(match);
    assert.equal(match.customer.isMasked, false);
    if (!match.customer.isMasked) {
      assert.equal(match.customer.id, SEED_IDS.customerStaffA);
      assert.ok("customerCode" in match.customer);
      assert.ok("displayName" in match.customer);
      assert.ok("salesStage" in match.customer);
      assert.equal(match.customer.href, `/customers/${SEED_IDS.customerStaffA}`);
      assert.equal(match.matchedField, "phone");
      assert.equal(
        Object.keys(match.customer).sort().join(","),
        "customerCode,displayName,href,id,isMasked,salesStage",
      );
    }
  });

  it("owner staff sees full authorized duplicate detail", async () => {
    const matches = await checkCustomerDuplicates(
      { phoneCountryCode: "+86", phone: STAFF_A_CUSTOMER_PHONE },
      staffA,
    );
    const match = matches.find((m) => m.field === "phone");
    assert.ok(match);
    assert.equal(match.customer.isMasked, false);
  });

  it("assignee collaborator staff sees authorized detail", async () => {
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
        { phoneCountryCode: "+86", phone: STAFF_A_CUSTOMER_PHONE },
        staffB,
      );
      const match = matches.find((m) => m.field === "phone");
      assert.ok(match);
      assert.equal(match.customer.isMasked, false);
    } finally {
      await db
        .delete(schema.customerAssignees)
        .where(eq(schema.customerAssignees.id, TEMP_COLLAB_ROW_ID));
    }
  });

  it("other staff gets opaque masked match", async () => {
    const matches = await checkCustomerDuplicates(
      { phoneCountryCode: "+86", phone: STAFF_A_CUSTOMER_PHONE },
      staffB,
    );
    const match = matches.find((m) => m.field === "phone");
    assert.ok(match);
    assert.equal(match.customer.isMasked, true);
    assert.deepEqual(Object.keys(match.customer), ["isMasked"]);
    assert.equal(match.matchedField, "phone");
  });

  it("staff gets opaque masked match for public pool", async () => {
    const matches = await checkCustomerDuplicates(
      { phoneCountryCode: "+86", phone: POOL_CUSTOMER_PHONE },
      staffA,
    );
    const match = matches.find((m) => m.field === "phone");
    assert.ok(match);
    assert.equal(match.customer.isMasked, true);
  });

  it("masked JSON exposes no customer-identifying data", async () => {
    const matches = await checkCustomerDuplicates(
      {
        phoneCountryCode: "+86",
        phone: POOL_CUSTOMER_PHONE,
        wechatId: POOL_CUSTOMER_WECHAT,
        email: POOL_CUSTOMER_EMAIL,
      },
      staffB,
    );
    assert.ok(matches.length > 0);
    const json = JSON.stringify(matches);
    for (const forbidden of [
      "customerName",
      "displayName",
      "customerCode",
      "salesStage",
      "href",
      "公共池测试客户",
      "status",
      "public_pool",
      SEED_IDS.customerPublicPool,
      POOL_CUSTOMER_PHONE,
      POOL_CUSTOMER_WECHAT,
      POOL_CUSTOMER_EMAIL,
      "ownerId",
    ]) {
      assert.ok(!json.includes(forbidden), `must not contain ${forbidden}`);
    }
  });

  it("blocks archived / recycle-bin customers", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.customers).values({
      id: TEMP_ARCHIVED_CUSTOMER_ID,
      customerName: "Archived Temp Customer",
      phoneCountryCode: "+86",
      phone: TEMP_ARCHIVED_PHONE,
      source: "other",
      status: "archived",
      deletedAt: now,
      ownerId: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      createdAt: now,
      updatedAt: now,
    });

    const matches = await checkCustomerDuplicates(
      { phoneCountryCode: "+86", phone: TEMP_ARCHIVED_PHONE },
      adminUser,
    );
    const match = matches.find((m) => m.field === "phone");
    assert.ok(match);
    assert.equal(match.customer.isMasked, false);
    if (!match.customer.isMasked) {
      assert.equal(match.customer.id, TEMP_ARCHIVED_CUSTOMER_ID);
    }
  });

  it("excludeId excludes self primary contact", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.customers).values({
      id: TEMP_EXCLUDE_CUSTOMER_ID,
      customerName: "Exclude Solo Temp Customer",
      phoneCountryCode: "+86",
      phone: TEMP_EXCLUDE_PHONE,
      source: "other",
      status: "active",
      ownerId: SEED_IDS.admin,
      createdBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const matches = await checkCustomerDuplicates(
        { phoneCountryCode: "+86", phone: TEMP_EXCLUDE_PHONE },
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

  it("excludeId does not hide other customers sharing the phone", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.customers).values([
      {
        id: TEMP_DUP_A_ID,
        customerName: "Exclude Pair Temp A",
        phoneCountryCode: "+86",
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
        phoneCountryCode: "+86",
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
        { phoneCountryCode: "+86", phone: TEMP_DUP_PHONE },
        adminUser,
        TEMP_DUP_A_ID,
      );
      const phoneMatches = matches.filter((m) => m.field === "phone");
      const matchedIds = phoneMatches.map((m) =>
        !m.customer.isMasked ? m.customer.id : null,
      );
      assert.deepEqual(matchedIds, [TEMP_DUP_B_ID]);
    } finally {
      await db.delete(schema.customers).where(eq(schema.customers.id, TEMP_DUP_A_ID));
      await db.delete(schema.customers).where(eq(schema.customers.id, TEMP_DUP_B_ID));
    }
  });

  it("matches secondary customer_contacts phone/wechat/email", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.customers).values({
      id: TEMP_CONTACT_CUSTOMER_ID,
      customerName: "Contact Parent Customer",
      phoneCountryCode: "+86",
      phone: "18800000099",
      source: "other",
      status: "active",
      ownerId: SEED_IDS.admin,
      createdBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.customerContacts).values({
      id: TEMP_CONTACT_ID,
      customerId: TEMP_CONTACT_CUSTOMER_ID,
      name: "Secondary",
      phone: TEMP_CONTACT_PHONE,
      wechatId: TEMP_CONTACT_WECHAT,
      email: TEMP_CONTACT_EMAIL,
      isPrimary: 0,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const phoneMatches = await checkCustomerDuplicates(
        { phoneCountryCode: "+86", phone: TEMP_CONTACT_PHONE },
        adminUser,
      );
      assert.ok(phoneMatches.some((m) => m.field === "phone"));

      const wechatMatches = await checkCustomerDuplicates(
        { wechatId: "dupcontact_wx" },
        adminUser,
      );
      assert.ok(wechatMatches.some((m) => m.field === "wechatId"));

      const emailMatches = await checkCustomerDuplicates(
        { email: "dup.contact@example.com" },
        adminUser,
      );
      assert.ok(emailMatches.some((m) => m.field === "email"));

      const excluded = await checkCustomerDuplicates(
        {
          phoneCountryCode: "+86",
          phone: TEMP_CONTACT_PHONE,
          wechatId: TEMP_CONTACT_WECHAT,
          email: TEMP_CONTACT_EMAIL,
        },
        adminUser,
        TEMP_CONTACT_CUSTOMER_ID,
      );
      assert.deepEqual(excluded, []);
    } finally {
      await db
        .delete(schema.customerContacts)
        .where(eq(schema.customerContacts.id, TEMP_CONTACT_ID));
      await db
        .delete(schema.customers)
        .where(eq(schema.customers.id, TEMP_CONTACT_CUSTOMER_ID));
    }
  });

  it("formats phone input with separators still match seed phone", async () => {
    const matches = await checkCustomerDuplicates(
      { phoneCountryCode: "+86", phone: "138-0000-0001" },
      adminUser,
    );
    assert.ok(matches.some((m) => m.field === "phone"));
  });

  it("email case-insensitive match against seed", async () => {
    const matches = await checkCustomerDuplicates(
      { email: STAFF_A_CUSTOMER_EMAIL.toUpperCase() },
      adminUser,
    );
    assert.ok(matches.some((m) => m.field === "email"));
  });

  it("different country code does not match same national digits", async () => {
    const matches = await checkCustomerDuplicates(
      { phoneCountryCode: "+1", phone: STAFF_A_CUSTOMER_PHONE },
      adminUser,
    );
    assert.equal(
      matches.filter((m) => m.field === "phone").length,
      0,
    );
  });
});
