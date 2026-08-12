import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { approveApprovalRequest, ApprovalError } from "@/lib/approvals/service";
import { getApprovalById } from "@/lib/approvals/queries";
import { searchFamilyCandidates } from "./family-candidates";
import {
  approveFamilyLinkApprovalRequest,
  createFamilyLinkApprovalRequest,
  findPendingFamilyLinkPair,
  submitFamilyLinkRequest,
} from "./family-link-approval";
import { executeFamilyLink } from "./link-existing";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";

const NOW = "2026-08-12T18:00:00.000Z";
const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

const STALE_A = "f1-stale-a";
const STALE_B = "f1-stale-b";
const CONFLICT_A = "f1-conflict-a";
const CONFLICT_B = "f1-conflict-b";
const CONFLICT_C = "f1-conflict-c";
const RECOVERY_A = "f1-recovery-a";
const RECOVERY_B = "f1-recovery-b";
const DEDUP_A = "f1-dedup-a";
const DEDUP_B = "f1-dedup-b";
const DEDUP_C = "f1-dedup-c";
const SEARCH_OWN = "f1-search-own";
const SEARCH_PROTECTED = "f1-search-protected";
const SEARCH_BROAD = "f1-search-broad";

function customerRow(
  id: string,
  ownerId: string,
  overrides: Partial<typeof schema.customers.$inferInsert> = {},
) {
  return {
    id,
    customerName: `F1 ${id}`,
    customerType: "individual" as const,
    source: "referral",
    ownerId,
    status: "active" as const,
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } satisfies typeof schema.customers.$inferInsert;
}

async function countHouseholdState(db: ReturnType<typeof drizzle<typeof schema>>) {
  const households = await db.select().from(schema.customerHouseholds);
  const members = await db
    .select()
    .from(schema.customerHouseholdMembers)
    .where(isNull(schema.customerHouseholdMembers.leftAt));
  const relationships = await db.select().from(schema.customerHouseholdRelationships);
  return {
    households: households.length,
    members: members.length,
    relationships: relationships.length,
  };
}

function broadSearch(
  db: ReturnType<typeof drizzle<typeof schema>>,
  user: User,
  source: typeof schema.customers.$inferSelect,
  q: string,
) {
  return searchFamilyCandidates(db, user, source, { q, mode: "broad" });
}

function exactSearch(
  db: ReturnType<typeof drizzle<typeof schema>>,
  user: User,
  source: typeof schema.customers.$inferSelect,
  kind: "customerCode" | "phone" | "wechatId" | "email",
  q: string,
) {
  return searchFamilyCandidates(db, user, source, { q, mode: "exact", kind });
}

function wrapD1WithQueryCounter(rawDb: {
  prepare: (query: string) => unknown;
  batch: (statements: readonly unknown[]) => Promise<unknown>;
  exec: (query: string) => Promise<unknown>;
  withSession?: (...args: unknown[]) => unknown;
  dump?: () => Promise<ArrayBuffer>;
}) {
  let queryCount = 0;
  const counter = {
    get count() {
      return queryCount;
    },
    reset() {
      queryCount = 0;
    },
  };

  const wrapped = {
    prepare(query: string) {
      queryCount++;
      return rawDb.prepare(query);
    },
    batch: (statements: readonly unknown[]) => {
      queryCount += statements.length;
      return rawDb.batch(statements);
    },
    exec: (query: string) => rawDb.exec(query),
    withSession: (...args: unknown[]) => rawDb.withSession?.(...args),
    dump: () => rawDb.dump?.() ?? Promise.resolve(new ArrayBuffer(0)),
  };

  return { wrapped, counter };
}

describe("family link F1 hardening", () => {
  let dispose: (() => Promise<void>) | undefined;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let queryCounter: { count: number; reset: () => void };

  before(async () => {
    const proxy = await getPlatformProxy({ configPath: "./wrangler.jsonc" });
    dispose = proxy.dispose;
    const { wrapped, counter } = wrapD1WithQueryCounter(
      proxy.env.DB as Parameters<typeof wrapD1WithQueryCounter>[0],
    );
    queryCounter = counter;
    db = drizzle(wrapped as typeof proxy.env.DB, { schema });
    bindTestDatabase(db);

    await db.delete(schema.customerHouseholdRelationships);
    await db.delete(schema.customerHouseholdMembers);
    await db.delete(schema.customerHouseholds);
    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.requestType, "link_family_customer"));

    const ids = [
      STALE_A,
      STALE_B,
      CONFLICT_A,
      CONFLICT_B,
      CONFLICT_C,
      RECOVERY_A,
      RECOVERY_B,
      DEDUP_A,
      DEDUP_B,
      DEDUP_C,
      SEARCH_OWN,
      SEARCH_PROTECTED,
      SEARCH_BROAD,
    ];
    for (const id of ids) {
      await db.delete(schema.customers).where(eq(schema.customers.id, id));
    }

    await db.insert(schema.customers).values(
      customerRow(STALE_A, SEED_IDS.staffA),
    );
    await db.insert(schema.customers).values(
      customerRow(STALE_B, SEED_IDS.staffB, { phone: "13900009991" }),
    );
    await db.insert(schema.customers).values(
      customerRow(CONFLICT_A, SEED_IDS.staffA),
    );
    await db.insert(schema.customers).values(
      customerRow(CONFLICT_B, SEED_IDS.staffB, { phone: "13900007771" }),
    );
    await db.insert(schema.customers).values(
      customerRow(CONFLICT_C, SEED_IDS.staffB, { phone: "13900007772" }),
    );
    await db.insert(schema.customers).values(
      customerRow(RECOVERY_A, SEED_IDS.staffA),
    );
    await db.insert(schema.customers).values(
      customerRow(RECOVERY_B, SEED_IDS.staffB, { phone: "13900006661" }),
    );
    await db.insert(schema.customers).values(
      customerRow(DEDUP_A, SEED_IDS.staffA),
    );
    await db.insert(schema.customers).values(
      customerRow(DEDUP_B, SEED_IDS.staffB, { phone: "13900005551" }),
    );
    await db.insert(schema.customers).values(
      customerRow(DEDUP_C, SEED_IDS.staffB, { phone: "13900005552" }),
    );
    await db.insert(schema.customers).values(
      customerRow(SEARCH_OWN, SEED_IDS.staffA, { customerName: "99Own Visible" }),
    );
    await db.insert(schema.customers).values(
      customerRow(SEARCH_PROTECTED, SEED_IDS.staffB, {
        customerName: "F1 Protected Hidden",
        phone: "13900008881",
        customerCode: "EF888881",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(SEARCH_BROAD, SEED_IDS.staffB, {
        customerName: "F1 Broad Hidden",
      }),
    );
  });

  after(async () => {
    await dispose?.();
  });

  it("rejects stale approval snapshot after rejection without household writes", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, STALE_A)).limit(1)
    )[0]!;
    const target = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, STALE_B)).limit(1)
    )[0]!;

    const before = await countHouseholdState(db);

    const created = await createFamilyLinkApprovalRequest(
      db,
      source,
      staffA,
      target,
      "mother",
    );
    const fresh = await getApprovalById(db, created.id);
    assert.ok(fresh);
    const staleApproval = { ...fresh!, status: "pending" as const };

    await db
      .update(schema.approvals)
      .set({ status: "rejected", updatedAt: NOW })
      .where(eq(schema.approvals.id, created.id));

    await assert.rejects(
      () => approveFamilyLinkApprovalRequest(db, staleApproval, admin),
      (error: unknown) =>
        error instanceof ApprovalError &&
        error.status === 409,
    );

    const approval = await getApprovalById(db, created.id);
    assert.equal(approval?.status, "rejected");

    const after = await countHouseholdState(db);
    assert.deepEqual(after, before);
  });

  it("approves pending family link atomically with household writes", async () => {
    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.requestType, "link_family_customer"));

    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, STALE_A)).limit(1)
    )[0]!;
    const target = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, STALE_B)).limit(1)
    )[0]!;

    const created = await createFamilyLinkApprovalRequest(
      db,
      source,
      staffA,
      target,
      "father",
    );

    await approveApprovalRequest(created.id, admin, "approved");

    const approval = await getApprovalById(db, created.id);
    assert.equal(approval?.status, "approved");

    const members = await db
      .select()
      .from(schema.customerHouseholdMembers)
      .where(isNull(schema.customerHouseholdMembers.leftAt));
    assert.ok(members.some((row) => row.customerId === STALE_A));
    assert.ok(members.some((row) => row.customerId === STALE_B));
  });

  it("keeps approval pending when household conflict appears before approval", async () => {
    await db.delete(schema.customerHouseholdRelationships);
    await db.delete(schema.customerHouseholdMembers);
    await db.delete(schema.customerHouseholds);
    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.requestType, "link_family_customer"));

    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, CONFLICT_A)).limit(1)
    )[0]!;
    const targetC = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, CONFLICT_C)).limit(1)
    )[0]!;

    await executeFamilyLink(db, {
      source,
      target: targetC,
      relationshipType: "father",
      actor: admin,
    });

    const pending = await submitFamilyLinkRequest(db, source, staffA, {
      relationshipType: "brother",
      protectedLookup: { kind: "phone", value: "13900007771" },
    });
    assert.equal(pending.mode, "approval");

    const hhId = crypto.randomUUID();
    await db.insert(schema.customerHouseholds).values({
      id: hhId,
      status: "active",
      createdFromCustomerId: CONFLICT_B,
      createdBy: SEED_IDS.admin,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(schema.customerHouseholdMembers).values({
      id: crypto.randomUUID(),
      householdId: hhId,
      customerId: CONFLICT_B,
      joinedAt: NOW,
      joinedBy: SEED_IDS.admin,
    });

    if (pending.mode !== "approval") {
      throw new Error("expected approval");
    }

    await assert.rejects(
      () => approveApprovalRequest(pending.approvalId, admin),
      (error: unknown) =>
        !!error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code: string }).code === FAMILY_ERROR_CODES.HOUSEHOLD_CONFLICT,
    );

    const approval = await getApprovalById(db, pending.approvalId);
    assert.equal(approval?.status, "pending");
  });

  it("recovers already-linked approval without duplicate household rows", async () => {
    await db.delete(schema.customerHouseholdRelationships);
    await db.delete(schema.customerHouseholdMembers);
    await db.delete(schema.customerHouseholds);
    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.requestType, "link_family_customer"));

    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, RECOVERY_A)).limit(1)
    )[0]!;
    const target = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, RECOVERY_B)).limit(1)
    )[0]!;

    await executeFamilyLink(db, {
      source,
      target,
      relationshipType: "father",
      actor: admin,
    });

    const approvalId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(schema.approvals).values({
      id: approvalId,
      requestType: "link_family_customer",
      status: "pending",
      customerId: source.id,
      requestedBy: staffA.id,
      relatedCustomerIds: JSON.stringify([target.id]),
      payload: JSON.stringify({ relationshipType: "father" }),
      reason: "Family customer link request",
      createdAt: now,
      updatedAt: now,
    });

    const before = await countHouseholdState(db);

    await approveFamilyLinkApprovalRequest(
      db,
      {
        id: approvalId,
        customerId: source.id,
        requestedBy: staffA.id,
        relatedCustomerIds: JSON.stringify([target.id]),
        payload: JSON.stringify({ relationshipType: "father" }),
        status: "pending",
      },
      admin,
    );

    const approval = await getApprovalById(db, approvalId);
    assert.equal(approval?.status, "approved");

    const after = await countHouseholdState(db);
    assert.deepEqual(after, before);
  });

  it("broad search uses one bounded customers query", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, STALE_A)).limit(1)
    )[0]!;

    queryCounter.reset();
    await broadSearch(db, staffA, source, "99Ow");
    const narrowCount = queryCounter.count;

    queryCounter.reset();
    const results = await broadSearch(db, staffA, source, "99Own Visible");
    const broadCount = queryCounter.count;

    assert.equal(broadCount, narrowCount);
    assert.ok(broadCount <= 2);
    assert.ok(results.some((row) => !row.isMasked && row.customerId === SEARCH_OWN));
    assert.ok(
      !results.some(
        (row) => !row.isMasked && row.customerId === SEARCH_BROAD,
      ),
    );
  });

  it("broad search avoids per-candidate assignee queries", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, STALE_A)).limit(1)
    )[0]!;

    queryCounter.reset();
    await broadSearch(db, staffA, source, "F1");
    const multiCount = queryCounter.count;

    assert.ok(multiCount <= 2);
  });

  it("hides protected broad-name matches from staff", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, STALE_A)).limit(1)
    )[0]!;

    const results = await broadSearch(db, staffA, source, "Protected Hidden");
    assert.equal(results.length, 0);
  });

  it("returns masked protected exact matches without identifiers", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, STALE_A)).limit(1)
    )[0]!;

    const results = await exactSearch(db, staffA, source, "customerCode", "EF888881");
    assert.equal(results.length, 1);
    const row = results[0]!;
    assert.equal(row.isMasked, true);
    if (row.isMasked) {
      assert.equal(row.requiresApproval, true);
      assert.equal("customerId" in row, false);
      assert.equal("customerName" in row, false);
      assert.equal("customerCode" in row, false);
    }
  });

  it("rejects duplicate pending pair A to B", async () => {
    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.requestType, "link_family_customer"));

    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, DEDUP_A)).limit(1)
    )[0]!;
    const targetB = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, DEDUP_B)).limit(1)
    )[0]!;

    await createFamilyLinkApprovalRequest(db, source, staffA, targetB, "mother");

    await assert.rejects(
      () => createFamilyLinkApprovalRequest(db, source, staffA, targetB, "mother"),
      (error: unknown) =>
        error instanceof FamilyLinkError &&
        error.errorCode === FAMILY_ERROR_CODES.DUPLICATE_PENDING,
    );
  });

  it("rejects duplicate pending reverse pair B to A", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, DEDUP_B)).limit(1)
    )[0]!;
    const targetA = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, DEDUP_A)).limit(1)
    )[0]!;

    await assert.rejects(
      () => createFamilyLinkApprovalRequest(db, source, staffB, targetA, "mother"),
      (error: unknown) =>
        error instanceof FamilyLinkError &&
        error.errorCode === FAMILY_ERROR_CODES.DUPLICATE_PENDING,
    );
  });

  it("allows pending pair with different target", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, DEDUP_A)).limit(1)
    )[0]!;
    const targetC = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, DEDUP_C)).limit(1)
    )[0]!;

    const created = await createFamilyLinkApprovalRequest(
      db,
      source,
      staffA,
      targetC,
      "sister",
    );
    assert.ok(created.id);

    const pendingForPair = await findPendingFamilyLinkPair(db, DEDUP_A, DEDUP_B);
    const pendingForOther = await findPendingFamilyLinkPair(db, DEDUP_A, DEDUP_C);
    assert.ok(pendingForPair);
    assert.ok(pendingForOther);
    assert.notEqual(pendingForPair.id, pendingForOther.id);
  });

  it("atomic pair insert leaves exactly one pending approval for unordered pair", async () => {
    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.requestType, "link_family_customer"));

    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, DEDUP_A)).limit(1)
    )[0]!;
    const target = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, DEDUP_B)).limit(1)
    )[0]!;

    const first = await createFamilyLinkApprovalRequest(
      db,
      source,
      staffA,
      target,
      "father",
    );

    let duplicateError: FamilyLinkError | null = null;
    try {
      await createFamilyLinkApprovalRequest(db, source, staffA, target, "father");
    } catch (error) {
      if (error instanceof FamilyLinkError) {
        duplicateError = error;
      } else {
        throw error;
      }
    }
    assert.ok(duplicateError);
    assert.equal(duplicateError.errorCode, FAMILY_ERROR_CODES.DUPLICATE_PENDING);

    const pending = await db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.requestType, "link_family_customer"),
          eq(schema.approvals.status, "pending"),
        ),
      );
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.id, first.id);
  });
});
