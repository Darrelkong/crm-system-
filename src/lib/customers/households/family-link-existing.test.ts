import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { approveApprovalRequest } from "@/lib/approvals/service";
import { getApprovalById } from "@/lib/approvals/queries";
import {
  sanitizeApprovalListItemForUser,
} from "@/lib/approvals/family-link-serialization";
import { listApprovalsForUser } from "@/lib/approvals/queries";
import { executeFamilyLink } from "./link-existing";
import { submitFamilyLinkRequest } from "./family-link-approval";
import { getCustomerIdsWithHouseholdIcon } from "./list-indicator";
import { getCustomerHouseholdDetailSummary } from "./detail-summary";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";

const NOW = "2026-08-12T12:00:00.000Z";
const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

const A = "b4-cust-a";
const B = "b4-cust-b";
const C = "b4-cust-c";
const D = "b4-cust-d";
const COMPANY = "b4-cust-company";

function customerRow(
  id: string,
  ownerId: string,
  overrides: Partial<typeof schema.customers.$inferInsert> = {},
) {
  return {
    id,
    customerName: `B4 ${id}`,
    customerType: "individual",
    source: "referral",
    ownerId,
    status: "active",
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("family link existing", () => {
  let dispose: (() => Promise<void>) | undefined;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  before(async () => {
    const proxy = await getPlatformProxy({ configPath: "./wrangler.jsonc" });
    dispose = proxy.dispose;
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);

    await db.delete(schema.customerHouseholdRelationships);
    await db.delete(schema.customerHouseholdMembers);
    await db.delete(schema.customerHouseholds);
    await db.delete(schema.approvals).where(
      eq(schema.approvals.requestType, "link_family_customer"),
    );

    for (const id of [A, B, C, D, COMPANY]) {
      await db.delete(schema.customers).where(eq(schema.customers.id, id));
    }

    await db.insert(schema.customers).values([
      customerRow(A, SEED_IDS.staffA),
      customerRow(B, SEED_IDS.staffA),
      customerRow(C, SEED_IDS.staffB, { phone: "13900001111", wechatId: "b4c" }),
      customerRow(D, SEED_IDS.staffB),
      customerRow(COMPANY, SEED_IDS.staffA, { customerType: "company" }),
    ] as Array<typeof schema.customers.$inferInsert>);
  });

  after(async () => {
    await dispose?.();
  });

  it("creates household + memberships + relationship on direct link", async () => {
    const source = (await db.select().from(schema.customers).where(eq(schema.customers.id, A)).limit(1))[0]!;
    const target = (await db.select().from(schema.customers).where(eq(schema.customers.id, B)).limit(1))[0]!;

    const result = await executeFamilyLink(db, {
      source,
      target,
      relationshipType: "father",
      actor: staffA,
    });

    assert.equal(result.kind, "create_household");

    const households = await db.select().from(schema.customerHouseholds);
    const members = await db
      .select()
      .from(schema.customerHouseholdMembers)
      .where(isNull(schema.customerHouseholdMembers.leftAt));
    const relationships = await db.select().from(schema.customerHouseholdRelationships);

    assert.equal(households.length, 1);
    assert.equal(members.length, 2);
    assert.equal(relationships.length, 1);
    assert.equal(relationships[0]?.relationshipType, "father");
  });

  it("is idempotent for the same semantic relationship", async () => {
    const source = (await db.select().from(schema.customers).where(eq(schema.customers.id, A)).limit(1))[0]!;
    const target = (await db.select().from(schema.customers).where(eq(schema.customers.id, B)).limit(1))[0]!;

    const result = await executeFamilyLink(db, {
      source,
      target,
      relationshipType: "father",
      actor: staffA,
    });

    assert.equal(result.kind, "already_linked");
  });

  it("rejects relationship conflict", async () => {
    const source = (await db.select().from(schema.customers).where(eq(schema.customers.id, A)).limit(1))[0]!;
    const target = (await db.select().from(schema.customers).where(eq(schema.customers.id, B)).limit(1))[0]!;

    await assert.rejects(
      () =>
        executeFamilyLink(db, {
          source,
          target,
          relationshipType: "spouse",
          actor: staffA,
        }),
      (error: unknown) =>
        error instanceof FamilyLinkError &&
        error.errorCode === FAMILY_ERROR_CODES.RELATIONSHIP_CONFLICT,
    );
  });

  it("requires approval for cross-owner protected target", async () => {
    const source = (await db.select().from(schema.customers).where(eq(schema.customers.id, A)).limit(1))[0]!;

    const result = await submitFamilyLinkRequest(db, source, staffA, {
      relationshipType: "mother",
      protectedLookup: { kind: "phone", value: "13900001111" },
    });

    assert.equal(result.mode, "approval");
    if (result.mode === "approval") {
      const approval = await getApprovalById(db, result.approvalId);
      assert.equal(approval?.requestType, "link_family_customer");
      assert.equal(approval?.status, "pending");
    }

    const members = await db
      .select()
      .from(schema.customerHouseholdMembers)
      .where(isNull(schema.customerHouseholdMembers.leftAt));
    assert.equal(members.length, 2);
  });

  it("keeps approval pending when household conflict appears before approval", async () => {
    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.requestType, "link_family_customer"));

    const source = (await db.select().from(schema.customers).where(eq(schema.customers.id, A)).limit(1))[0]!;

    const pending = await submitFamilyLinkRequest(db, source, staffA, {
      relationshipType: "brother",
      protectedLookup: { kind: "phone", value: "13900001111" },
    });
    assert.equal(pending.mode, "approval");

    const hhId = crypto.randomUUID();
    await db.insert(schema.customerHouseholds).values({
      id: hhId,
      status: "active",
      createdFromCustomerId: C,
      createdBy: SEED_IDS.admin,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(schema.customerHouseholdMembers).values({
      id: crypto.randomUUID(),
      householdId: hhId,
      customerId: C,
      joinedAt: NOW,
      joinedBy: SEED_IDS.admin,
    });
    await db.insert(schema.customerHouseholdMembers).values({
      id: crypto.randomUUID(),
      householdId: hhId,
      customerId: D,
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

  it("sanitizes staff family approval responses", async () => {
    const items = await listApprovalsForUser(db, staffA);
    const familyItem = items.find((item) => item.requestType === "link_family_customer");
    assert.ok(familyItem);

    const serialized = sanitizeApprovalListItemForUser(staffA, familyItem);
    const json = JSON.stringify(serialized);
    assert.doesNotMatch(json, new RegExp(C));
    assert.equal(serialized.relatedCustomerIds, null);
    assert.equal(serialized.payload, null);
  });

  it("shows household icon and detail summary after link", async () => {
    const icons = await getCustomerIdsWithHouseholdIcon(db, [A, B]);
    assert.deepEqual(new Set(icons), new Set([A, B]));

    const summary = await getCustomerHouseholdDetailSummary(db, admin, { id: A });
    assert.ok(summary);
    assert.equal(summary?.members[0]?.customerId, B);
  });

  it("rejects company target", async () => {
    const source = (await db.select().from(schema.customers).where(eq(schema.customers.id, A)).limit(1))[0]!;

    await assert.rejects(
      () =>
        submitFamilyLinkRequest(db, source, staffA, {
          relationshipType: "father",
          targetCustomerId: COMPANY,
        }),
      (error: unknown) =>
        error instanceof FamilyLinkError &&
        error.errorCode === FAMILY_ERROR_CODES.TARGET_NOT_ELIGIBLE,
    );
  });
});
