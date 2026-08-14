import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getActiveCustomerTagKeys } from "@/lib/customer-tags/queries";
import {
  executePreparedCustomerCreation,
  prepareCustomerCreation,
} from "@/lib/customers/create-customer-service";
import { normalizeCustomerNameForDuplicateMatch } from "@/lib/customers/name-duplicate";
import { createFamilyMemberCustomer } from "./family-create-new";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";
import { executeFamilyLink } from "./link-existing";

const NOW = "2026-08-12T16:00:00.000Z";
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const admin = { id: SEED_IDS.admin, role: "admin" } as User;

const SOURCE = "b5-source";
const MEMBER_C = "b5-member-c";
const DUP_PHONE = "b5-dup-phone";
const ROLLBACK_SOURCE = "b5-rollback-source";
const COMPANY_SOURCE = "b5-company-source";
const ARCHIVED_SOURCE = "b5-archived-source";
const DELETED_SOURCE = "b5-deleted-source";
const PROTECTED_SOURCE = "b5-protected-source";
const NAME_DUP_EXISTING = "b5-name-dup-existing";

const B5_TEST_PHONES = [
  "13888776001",
  "13888776002",
  "13888776003",
  "13888776004",
  "13888776005",
  "13888776006",
];
const B5_TEST_NAMES = ["王小明", "王建国", "赵六", "孙七", "周八"];

let allowedSourceKeys: string[] = ["referral"];

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function customerRow(
  id: string,
  ownerId: string,
  overrides: Partial<typeof schema.customers.$inferInsert> = {},
) {
  return {
    id,
    customerName: `B5 ${id}`,
    customerType: "individual" as const,
    source: "referral",
    ownerId,
    status: "active" as const,
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const B5_CREATE_NAME = "王小明";
const B5_CREATE_NAME_2 = "王建国";
const B5_NOTES =
  "客户当前处于初步沟通阶段，需要进一步跟进确认需求。";

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    customerName: B5_CREATE_NAME,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13888776001",
    wechatId: "b5_wx_001",
    email: "b5_001@example.com",
    source: allowedSourceKeys[0] ?? "referral",
    requestedProjectCode: "hk_bank_account",
    salesStage: "new_lead",
    notes: B5_NOTES,
    relationshipType: "father",
    ...overrides,
  };
}

async function deleteCustomerGraph(db: TestDb, customerId: string) {
  await db
    .delete(schema.customerHouseholdRelationships)
    .where(
      or(
        eq(schema.customerHouseholdRelationships.fromCustomerId, customerId),
        eq(schema.customerHouseholdRelationships.toCustomerId, customerId),
      ),
    );
  await db
    .delete(schema.customerHouseholdMembers)
    .where(eq(schema.customerHouseholdMembers.customerId, customerId));
  await db
    .delete(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, customerId));
  await db
    .delete(schema.customerContactIdentifiers)
    .where(eq(schema.customerContactIdentifiers.customerId, customerId));
  await db.delete(schema.approvals).where(eq(schema.approvals.customerId, customerId));
  await db.delete(schema.customers).where(eq(schema.customers.id, customerId));
}

async function cleanupB5Artifacts(db: TestDb) {
  const createdByContact = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(
      or(
        inArray(schema.customers.phone, B5_TEST_PHONES),
        inArray(schema.customers.customerName, B5_TEST_NAMES),
      ),
    );

  for (const row of createdByContact) {
    await deleteCustomerGraph(db, row.id);
  }

  await db.delete(schema.customerHouseholdRelationships);
  await db.delete(schema.customerHouseholdMembers);
  await db.delete(schema.customerHouseholds);
}

async function countRows(
  db: TestDb,
  customerName = B5_CREATE_NAME,
) {
  const [customers, households, members, relationships] = await Promise.all([
    db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.customerName, customerName)),
    db.select().from(schema.customerHouseholds),
    db
      .select()
      .from(schema.customerHouseholdMembers)
      .where(isNull(schema.customerHouseholdMembers.leftAt)),
    db.select().from(schema.customerHouseholdRelationships),
  ]);
  return {
    customers: customers.length,
    households: households.length,
    members: members.length,
    relationships: relationships.length,
  };
}

describe("family link B5 create new customer", () => {
  let dispose: (() => Promise<void>) | undefined;
  let db: TestDb;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({ configPath: "./wrangler.jsonc" });
    dispose = proxy.dispose;
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);

    await cleanupB5Artifacts(db);

    const fixtureIds = [
      SOURCE,
      MEMBER_C,
      DUP_PHONE,
      ROLLBACK_SOURCE,
      COMPANY_SOURCE,
      ARCHIVED_SOURCE,
      DELETED_SOURCE,
      PROTECTED_SOURCE,
      NAME_DUP_EXISTING,
    ];
    for (const id of fixtureIds) {
      await deleteCustomerGraph(db, id);
    }

    allowedSourceKeys = await getActiveCustomerTagKeys(db);

    const fixtureRows = [
      customerRow(SOURCE, SEED_IDS.staffA),
      customerRow(MEMBER_C, SEED_IDS.staffA),
      customerRow(ROLLBACK_SOURCE, SEED_IDS.staffA),
      customerRow(DUP_PHONE, SEED_IDS.staffA, {
        phoneCountryCode: "+86",
        phone: "13900006666",
      }),
      customerRow(COMPANY_SOURCE, SEED_IDS.staffA, {
        customerType: "company",
      }),
      customerRow(ARCHIVED_SOURCE, SEED_IDS.staffA, {
        status: "archived",
      }),
      customerRow(DELETED_SOURCE, SEED_IDS.staffA, {
        deletedAt: NOW,
      }),
      customerRow(PROTECTED_SOURCE, SEED_IDS.staffB, {
        phoneCountryCode: "+86",
        phone: "13900005555",
      }),
      customerRow(NAME_DUP_EXISTING, SEED_IDS.staffA, {
        customerName: "孙七",
      }),
    ];
    for (const row of fixtureRows) {
      await db.insert(schema.customers).values(row);
    }
  });

  after(async () => {
    await cleanupB5Artifacts(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("creates customer + household when source has no household", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;

    const outcome = await createFamilyMemberCustomer({
      db,
      source,
      actor: staffA,
      body: createBody(),
      allowedSourceKeys,
    });

    assert.ok("ok" in outcome && outcome.ok, JSON.stringify(outcome));

    const created = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, outcome.id))
      .limit(1);
    assert.equal(created.length, 1);
    assert.equal(created[0]?.customerType, "individual");
    assert.equal(created[0]?.ownerId, SEED_IDS.staffA);

    const assignees = await db
      .select()
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, outcome.id));
    assert.equal(assignees.length, 1);
    assert.equal(assignees[0]?.userId, SEED_IDS.staffA);

    const identifiers = await db
      .select()
      .from(schema.customerContactIdentifiers)
      .where(eq(schema.customerContactIdentifiers.customerId, outcome.id));
    assert.ok(identifiers.length >= 1);

    const members = await db
      .select()
      .from(schema.customerHouseholdMembers)
      .where(isNull(schema.customerHouseholdMembers.leftAt));
    assert.ok(members.some((row) => row.customerId === SOURCE));
    assert.ok(members.some((row) => row.customerId === outcome.id));

    const relationships = await db.select().from(schema.customerHouseholdRelationships);
    assert.equal(relationships.length, 1);
    assert.equal(relationships[0]?.fromCustomerId, SOURCE);
    assert.equal(relationships[0]?.toCustomerId, outcome.id);
    assert.equal(relationships[0]?.relationshipType, "father");
  });

  it("adds new member to existing source household", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const memberC = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, MEMBER_C)).limit(1)
    )[0]!;

    await executeFamilyLink(db, {
      source,
      target: memberC,
      relationshipType: "mother",
      actor: staffA,
    });

    const householdsBefore = await db.select().from(schema.customerHouseholds);
    const householdId = householdsBefore[0]?.id;
    assert.ok(householdId);

    const outcome = await createFamilyMemberCustomer({
      db,
      source,
      actor: staffA,
      body: createBody({
        customerName: B5_CREATE_NAME_2,
        phone: "13888776002",
        wechatId: "b5_wx_002",
        email: "b5_002@example.com",
        relationshipType: "son",
      }),
      allowedSourceKeys,
    });

    assert.ok("ok" in outcome && outcome.ok, JSON.stringify(outcome));

    const householdsAfter = await db.select().from(schema.customerHouseholds);
    assert.equal(householdsAfter.length, 1);
    assert.equal(householdsAfter[0]?.id, householdId);

    const members = await db
      .select()
      .from(schema.customerHouseholdMembers)
      .where(isNull(schema.customerHouseholdMembers.leftAt));
    assert.ok(members.some((row) => row.customerId === MEMBER_C));
    assert.ok(members.some((row) => row.customerId === outcome.id));
  });

  it("rejects manipulated company customer type with no writes", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const beforeCustomers = await db.select().from(schema.customers);

    await assert.rejects(
      () =>
        createFamilyMemberCustomer({
          db,
          source,
          actor: staffA,
          body: createBody({ customerType: "company", phone: "13888776003" }),
          allowedSourceKeys,
        }),
      (error: unknown) =>
        error instanceof FamilyLinkError &&
        error.errorCode === FAMILY_ERROR_CODES.TARGET_NOT_ELIGIBLE,
    );

    const afterCustomers = await db.select().from(schema.customers);
    assert.equal(afterCustomers.length, beforeCustomers.length);
  });

  it("rejects invalid source customers without creating target", async () => {
    const cases = [
      { id: COMPANY_SOURCE, actor: staffA },
      { id: ARCHIVED_SOURCE, actor: staffA },
      { id: DELETED_SOURCE, actor: staffA },
      { id: PROTECTED_SOURCE, actor: staffA },
    ] as const;

    for (const testCase of cases) {
      const source = (
        await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, testCase.id))
          .limit(1)
      )[0]!;
      const beforeCount = (
        await db.select().from(schema.customers).where(eq(schema.customers.phone, "13888776005"))
      ).length;

      await assert.rejects(
        () =>
          createFamilyMemberCustomer({
            db,
            source,
            actor: testCase.actor,
            body: createBody({
              customerName: "周八",
              phone: "13888776005",
              wechatId: "b5_wx_005",
            }),
            allowedSourceKeys,
          }),
        (error: unknown) => error instanceof FamilyLinkError,
      );

      const afterCount = (
        await db.select().from(schema.customers).where(eq(schema.customers.phone, "13888776005"))
      ).length;
      assert.equal(afterCount, beforeCount);
    }
  });

  it("returns duplicate contact without creating customer or household writes", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const before = await countRows(db);

    const outcome = await createFamilyMemberCustomer({
      db,
      source,
      actor: staffA,
      body: createBody({ phone: "13900006666", wechatId: null, email: null }),
      allowedSourceKeys,
    });

    assert.equal("kind" in outcome && outcome.kind === "duplicate", true);
    const after = await countRows(db);
    assert.equal(after.customers, before.customers);
    assert.equal(after.households, before.households);
    assert.equal(after.relationships, before.relationships);
  });

  it("masks protected duplicate contact", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;

    const outcome = await createFamilyMemberCustomer({
      db,
      source,
      actor: staffA,
      body: createBody({
        phone: "13900005555",
        wechatId: null,
        email: null,
      }),
      allowedSourceKeys,
    });

    assert.equal("kind" in outcome && outcome.kind === "duplicate", true);
    if (!("kind" in outcome) || outcome.kind !== "duplicate") return;
    assert.equal(outcome.duplicates[0]?.customer.isMasked, true);
  });

  it("returns duplicate name warning then creates once when confirmed", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, ROLLBACK_SOURCE)).limit(1)
    )[0]!;
    const normalized = normalizeCustomerNameForDuplicateMatch("孙七");
    assert.ok(normalized);

    const warning = await createFamilyMemberCustomer({
      db,
      source,
      actor: staffA,
      body: createBody({
        customerName: "孙七",
        phone: "13888776006",
        wechatId: "b5_wx_006",
        email: "b5_006@example.com",
      }),
      allowedSourceKeys,
    });
    assert.equal("kind" in warning && warning.kind === "name_duplicate", true);

    const beforeCount = (
      await db.select().from(schema.customers).where(eq(schema.customers.customerName, "孙七"))
    ).length;

    const created = await createFamilyMemberCustomer({
      db,
      source,
      actor: staffA,
      body: createBody({
        customerName: "孙七",
        phone: "13888776006",
        wechatId: "b5_wx_006",
        email: "b5_006@example.com",
        confirmDuplicateName: normalized,
      }),
      allowedSourceKeys,
    });
    assert.ok("ok" in created && created.ok, JSON.stringify(created));

    const afterCount = (
      await db.select().from(schema.customers).where(eq(schema.customers.customerName, "孙七"))
    ).length;
    assert.equal(afterCount, beforeCount + 1);
  });

  it("creates on-hold customer with family link and on-hold approval only", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, ROLLBACK_SOURCE)).limit(1)
    )[0]!;

    const outcome = await createFamilyMemberCustomer({
      db,
      source,
      actor: staffA,
      body: createBody({
        customerName: "周八",
        phone: "13888776005",
        wechatId: "b5_wx_005",
        email: "b5_005@example.com",
        salesStage: "on_hold",
        onHoldReason: "客户当前需要内部评估后再继续跟进。",
      }),
      allowedSourceKeys,
    });

    assert.ok("ok" in outcome && outcome.ok, JSON.stringify(outcome));
    if (!("ok" in outcome) || !outcome.ok) return;
    assert.equal(outcome.pendingApproval, true);

    const approvals = await db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.customerId, outcome.id),
          eq(schema.approvals.requestType, "create_on_hold_customer"),
        ),
      );
    assert.equal(approvals.length, 1);

    const familyApprovals = await db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.customerId, outcome.id),
          eq(schema.approvals.requestType, "link_family_customer"),
        ),
      );
    assert.equal(familyApprovals.length, 0);

    const relationships = await db
      .select()
      .from(schema.customerHouseholdRelationships)
      .where(
        or(
          eq(schema.customerHouseholdRelationships.fromCustomerId, ROLLBACK_SOURCE),
          eq(schema.customerHouseholdRelationships.toCustomerId, outcome.id),
        ),
      );
    assert.ok(relationships.length >= 1);
  });

  it("rolls back customer writes when family batch append fails", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, ROLLBACK_SOURCE)).limit(1)
    )[0]!;
    const beforeCount = (
      await db.select().from(schema.customers).where(eq(schema.customers.phone, "13888776004"))
    ).length;

    await assert.rejects(
      () =>
        createFamilyMemberCustomer({
          db,
          source,
          actor: staffA,
          body: createBody({
            customerName: "赵六",
            phone: "13888776004",
            wechatId: "b5_wx_004",
            email: "b5_004@example.com",
          }),
          allowedSourceKeys,
          testAppendStatements: [
            db.run(sql`INSERT INTO not_a_real_table DEFAULT VALUES`),
          ],
        }),
    );

    const afterCount = (
      await db.select().from(schema.customers).where(eq(schema.customers.phone, "13888776004"))
    ).length;
    assert.equal(afterCount, beforeCount);

    const orphanAssignees = await db
      .select()
      .from(schema.customerAssignees)
      .innerJoin(
        schema.customers,
        eq(schema.customerAssignees.customerId, schema.customers.id),
      )
      .where(eq(schema.customers.phone, "13888776004"));
    assert.equal(orphanAssignees.length, 0);
  });
});

describe("B5 shared customer create service regression", () => {
  let dispose: (() => Promise<void>) | undefined;
  let db: TestDb;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({ configPath: "./wrangler.jsonc" });
    dispose = proxy.dispose;
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    allowedSourceKeys = await getActiveCustomerTagKeys(db);
  });

  after(async () => {
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("POST /api/customers route delegates to create-customer-service", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("src/app/api/customers/route.ts", "utf8");
    assert.match(route, /prepareCustomerCreation/);
    assert.match(route, /executePreparedCustomerCreation/);
  });

  it("standard POST /api/customers create still succeeds via shared service", async () => {
    const phone = "13888776111";
    const existing = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.phone, phone));
    for (const row of existing) {
      await deleteCustomerGraph(db, row.id);
    }

    const prepared = await prepareCustomerCreation({
      actor: staffA,
      body: {
        customerName: "陈九",
        customerType: "individual",
        phoneCountryCode: "+86",
        phone,
        wechatId: "b5_std_wx",
        source: allowedSourceKeys[0] ?? "referral",
        requestedProjectCode: "hk_bank_account",
        salesStage: "new_lead",
        notes: B5_NOTES,
      },
      allowedSourceKeys,
      db,
    });
    assert.equal(prepared.kind, "ready");
    if (prepared.kind !== "ready") return;

    const result = await executePreparedCustomerCreation({
      db,
      actor: staffA,
      statements: prepared.statements,
      meta: prepared.meta,
    });
    assert.equal(result.kind, "created");

    const assignees = await db
      .select()
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, result.id));
    assert.equal(assignees.length, 1);
    assert.equal(assignees[0]?.userId, SEED_IDS.staffA);
  });

  it("admin create preserves owner resolution", async () => {
    const phone = "13888776112";
    const existing = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.phone, phone));
    for (const row of existing) {
      await deleteCustomerGraph(db, row.id);
    }

    const prepared = await prepareCustomerCreation({
      actor: admin,
      body: {
        customerName: "吴十",
        customerType: "individual",
        phoneCountryCode: "+86",
        phone,
        wechatId: "b5_admin_wx",
        source: allowedSourceKeys[0] ?? "referral",
        requestedProjectCode: "hk_bank_account",
        salesStage: "new_lead",
        notes: B5_NOTES,
        ownerId: SEED_IDS.staffB,
      },
      allowedSourceKeys,
      db,
    });
    assert.equal(prepared.kind, "ready");
    if (prepared.kind !== "ready") return;
    assert.equal(prepared.meta.ownerId, SEED_IDS.staffB);

    const result = await executePreparedCustomerCreation({
      db,
      actor: admin,
      statements: prepared.statements,
      meta: prepared.meta,
    });
    assert.equal(result.kind, "created");

    const created = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, result.id))
      .limit(1);
    assert.equal(created[0]?.ownerId, SEED_IDS.staffB);
  });
});
