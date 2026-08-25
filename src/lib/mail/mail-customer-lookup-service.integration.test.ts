import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  buildReplaceCustomerIdentifierStatements,
  loadSecondaryContactsForCustomer,
} from "@/lib/customers/contact-identifiers";
import { lookupMailCustomerByEmail } from "@/lib/mail/mail-customer-lookup-service";
import type { User } from "../../../drizzle/schema/users";

const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

const STAFF_A_CUSTOMER_EMAIL = "staff-a-customer@example.com";
const STAFF_B_CUSTOMER_EMAIL = "staff-b-customer@example.com";
const POOL_CUSTOMER_EMAIL = "pool-customer@example.com";

const SEED_CUSTOMER_IDS = [
  SEED_IDS.customerStaffA,
  SEED_IDS.customerStaffB,
  SEED_IDS.customerPublicPool,
] as const;

describe("lookupMailCustomerByEmail", () => {
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
    for (const customerId of SEED_CUSTOMER_IDS) {
      const [customer] = await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, customerId))
        .limit(1);
      if (!customer) continue;

      const secondaryContacts = await loadSecondaryContactsForCustomer(
        db,
        customerId,
      );
      const { statements } = buildReplaceCustomerIdentifierStatements(db, {
        customerId,
        phoneCountryCode: customer.phoneCountryCode,
        phone: customer.phone,
        wechatId: customer.wechatId,
        email: customer.email,
        secondaryContacts,
        now,
      });
      await db.batch(statements as [typeof statements[0], ...typeof statements]);
    }
  });

  after(async () => {
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("returns customer context for an existing seed customer email", async () => {
    const result = await lookupMailCustomerByEmail(
      db,
      adminUser,
      STAFF_A_CUSTOMER_EMAIL,
    );

    assert.equal(result.matched, true);
    assert.equal(result.matchType, "exact_email");
    assert.equal(result.accessLevel, "full");
    assert.ok(result.customer);
    assert.equal(result.customer.id, SEED_IDS.customerStaffA);
    assert.equal(result.customer.name, "Staff A 测试客户");
    assert.ok(result.customer.salesStage);
    assert.ok(result.customer.ownerName);
  });

  it("matches email regardless of casing", async () => {
    const result = await lookupMailCustomerByEmail(
      db,
      adminUser,
      "Staff-A-Customer@Example.com",
    );

    assert.equal(result.matched, true);
    assert.equal(result.matchType, "exact_email");
    assert.equal(result.customer?.id, SEED_IDS.customerStaffA);
  });

  it("allows staff owner to see customer summary", async () => {
    const result = await lookupMailCustomerByEmail(
      db,
      staffA,
      STAFF_A_CUSTOMER_EMAIL,
    );

    assert.equal(result.matched, true);
    assert.equal(result.matchType, "exact_email");
    assert.equal(result.accessLevel, "full");
    assert.equal(result.customer?.id, SEED_IDS.customerStaffA);
  });

  it("denies staff non-owner without exposing customer details", async () => {
    const result = await lookupMailCustomerByEmail(
      db,
      staffB,
      STAFF_A_CUSTOMER_EMAIL,
    );

    assert.equal(result.matched, false);
    assert.equal(result.matchType, "denied");
    assert.equal(result.accessLevel, "denied");
    assert.equal(result.customer, null);
  });

  it("does not expose public pool customer details to non-admin staff", async () => {
    const result = await lookupMailCustomerByEmail(
      db,
      staffA,
      POOL_CUSTOMER_EMAIL,
    );

    assert.equal(result.matched, false);
    assert.equal(result.matchType, "denied");
    assert.equal(result.accessLevel, "masked");
    assert.equal(result.customer, null);
  });

  it("allows admin to see public pool customer summary", async () => {
    const result = await lookupMailCustomerByEmail(
      db,
      adminUser,
      POOL_CUSTOMER_EMAIL,
    );

    assert.equal(result.matched, true);
    assert.equal(result.matchType, "exact_email");
    assert.equal(result.accessLevel, "full");
    assert.equal(result.customer?.id, SEED_IDS.customerPublicPool);
  });

  it("returns no_match for unknown email", async () => {
    const result = await lookupMailCustomerByEmail(
      db,
      adminUser,
      "nobody@example.com",
    );

    assert.equal(result.matched, false);
    assert.equal(result.matchType, "no_match");
    assert.equal(result.accessLevel, null);
    assert.equal(result.customer, null);
  });

  it("returns no_match for blank email input", async () => {
    const result = await lookupMailCustomerByEmail(db, adminUser, "   ");

    assert.equal(result.matched, false);
    assert.equal(result.matchType, "no_match");
    assert.equal(result.customer, null);
  });

  it("allows staff owner to look up their other owned customer email", async () => {
    const result = await lookupMailCustomerByEmail(
      db,
      staffB,
      STAFF_B_CUSTOMER_EMAIL,
    );

    assert.equal(result.matched, true);
    assert.equal(result.customer?.id, SEED_IDS.customerStaffB);
  });
});
