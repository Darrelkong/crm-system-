import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getActiveCustomerTagKeys } from "@/lib/customer-tags/queries";
import { bindTestDatabase } from "@/lib/db";
import {
  executePreparedCustomerCreation,
  prepareCustomerCreation,
} from "./create-customer-service";
import { verifyCollaboratorEmail } from "./collaborator-verification";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const owner = { id: SEED_IDS.staffA, role: "staff" } as User;
const admin = { id: SEED_IDS.admin, role: "admin" } as User;
let allowedSourceKeys: string[] = [];

function createBody(overrides: Record<string, unknown> = {}) {
  const unique = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  return {
    customerName: "PhaseTest Customer",
    customerType: "individual",
    phoneCountryCode: "+852",
    phone: `9${unique.slice(0, 7)}`,
    wechatId: `phase2-${unique}`,
    email: `${unique}@example.invalid`,
    source: allowedSourceKeys[0] ?? "referral",
    requestedProjectCode: "hk_bank_account",
    requestedProjectName: "香港银行开户",
    salesStage: "new_lead",
    notes: "这是用于协作成员创建测试的首次沟通记录。",
    ...overrides,
  };
}

async function cleanupCustomer(db: Db, customerId: string) {
  await db
    .delete(schema.notifications)
    .where(eq(schema.notifications.relatedEntityId, customerId));
  await db
    .delete(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityType, "customer"),
        eq(schema.auditLogs.entityId, customerId),
      ),
    );
  await db
    .delete(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, customerId));
  await db
    .delete(schema.customerContactIdentifiers)
    .where(eq(schema.customerContactIdentifiers.customerId, customerId));
  await db.delete(schema.customers).where(eq(schema.customers.id, customerId));
}

describe("customer creation collaboration phase 2", () => {
  let db: Db;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await db
      .delete(schema.customerTags)
      .where(eq(schema.customerTags.tagKey, "phase2-collaboration-source"));
    await db.insert(schema.customerTags).values({
      id: "phase2-collaboration-source-id",
      tagKey: "phase2-collaboration-source",
      label: "Phase 2 Collaboration Source",
      isSystem: false,
      isActive: true,
      sortOrder: 999,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    allowedSourceKeys = await getActiveCustomerTagKeys(db);
    if (allowedSourceKeys.length === 0) {
      allowedSourceKeys = ["referral"];
    }
    await db
      .update(schema.users)
      .set({ isActive: 1, deletedAt: null })
      .where(inArray(schema.users.id, [SEED_IDS.staffB, SEED_IDS.admin]));
  });

  after(async () => {
    await db
      .delete(schema.customerTags)
      .where(eq(schema.customerTags.tagKey, "phase2-collaboration-source"));
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("verifies pre-create email with the shared exact-match core", async () => {
    const target = (
      await db
        .select({
          email: schema.users.email,
          displayName: schema.users.displayName,
        })
        .from(schema.users)
        .where(eq(schema.users.id, SEED_IDS.staffB))
        .limit(1)
    )[0]!;

    assert.deepEqual(
      await verifyCollaboratorEmail(db, {
        actor: owner,
        primaryOwnerId: owner.id,
        email: ` ${target.email.toUpperCase()} `,
      }),
      {
        id: SEED_IDS.staffB,
        displayName: target.displayName,
        email: target.email.toLowerCase(),
      },
    );
    assert.equal(
      await verifyCollaboratorEmail(db, {
        actor: admin,
        primaryOwnerId: SEED_IDS.staffB,
        email: target.email,
      }),
      null,
    );
  });

  it("forces staff-created customers to the acting staff owner", async () => {
    const prepared = await prepareCustomerCreation({
      actor: owner,
      body: createBody({ ownerId: SEED_IDS.staffB }),
      allowedSourceKeys,
      db,
    });

    assert.equal(prepared.kind, "ready");
    if (prepared.kind === "ready") {
      assert.equal(prepared.meta.ownerId, owner.id);
    }
  });

  it("rejects an admin-selected owner from also being a collaborator", async () => {
    const prepared = await prepareCustomerCreation({
      actor: admin,
      body: createBody({
        ownerId: SEED_IDS.staffB,
        collaboratorIds: [SEED_IDS.staffB],
      }),
      allowedSourceKeys,
      db,
    });

    assert.equal(prepared.kind, "validation");
  });

  it("shows owner selection only for admin creation", () => {
    const form = readFileSync(
      new URL(
        "../../app/(dashboard)/customers/new/new-customer-form.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const page = readFileSync(
      new URL("../../app/(dashboard)/customers/new/page.tsx", import.meta.url),
      "utf8",
    );

    assert.match(form, /ownerOptions\.length > 0/);
    assert.match(form, /ownerId: primaryOwnerId/);
    assert.match(page, /user\.role === "admin"/);
  });

  it("writes owner, primary, collaborators, and audit events in one creation batch", async () => {
    const customerId = crypto.randomUUID();
    const prepared = await prepareCustomerCreation({
      actor: owner,
      body: createBody({ collaboratorIds: [SEED_IDS.staffB] }),
      allowedSourceKeys,
      db,
      preallocatedId: customerId,
    });
    if (prepared.kind !== "ready") {
      assert.fail(JSON.stringify(prepared));
    }

    await executePreparedCustomerCreation({
      db,
      actor: owner,
      statements: prepared.statements,
      meta: prepared.meta,
    });

    const customer = (
      await db
        .select({
          ownerId: schema.customers.ownerId,
          previousOwnerId: schema.customers.previousOwnerId,
        })
        .from(schema.customers)
        .where(eq(schema.customers.id, customerId))
    )[0]!;
    const assignees = await db
      .select({
        userId: schema.customerAssignees.userId,
        role: schema.customerAssignees.role,
      })
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, customerId));
    const collaboratorAudits = await db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, customerId),
          eq(schema.auditLogs.action, "customer.collaborator_added"),
        ),
      );

    assert.equal(customer.ownerId, owner.id);
    assert.equal(customer.previousOwnerId, null);
    assert.deepEqual(assignees, [
      { userId: owner.id, role: "primary" },
      { userId: SEED_IDS.staffB, role: "collaborator" },
    ]);
    assert.equal(collaboratorAudits.length, 1);
    await cleanupCustomer(db, customerId);
  });

  it("rejects an invalid collaborator before customer writes", async () => {
    const customerId = crypto.randomUUID();
    const prepared = await prepareCustomerCreation({
      actor: owner,
      body: createBody({ collaboratorIds: [SEED_IDS.admin] }),
      allowedSourceKeys,
      db,
      preallocatedId: customerId,
    });
    assert.equal(prepared.kind, "validation");
    assert.equal(
      (
        await db
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(eq(schema.customers.id, customerId))
      ).length,
      0,
    );
    assert.equal(
      (
        await db
          .select({ id: schema.customerAssignees.id })
          .from(schema.customerAssignees)
          .where(eq(schema.customerAssignees.customerId, customerId))
      ).length,
      0,
    );
  });

  it("keeps the new form exact-email-only and supports local multi-selection", () => {
    const form = readFileSync(
      new URL(
        "../../app/(dashboard)/customers/new/new-customer-form.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const picker = readFileSync(
      new URL(
        "../../app/(dashboard)/customers/new/customer-create-collaborators.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(form, /CustomerCreateCollaborators/);
    assert.match(form, /collaboratorIds/);
    assert.match(picker, /协作成员|collaboratorsOptional/);
    assert.match(picker, /\/api\/customers\/collaborators\/verify/);
    assert.doesNotMatch(picker, /\/api\/users\/staff/);
    assert.match(picker, /selected\.filter/);
    assert.match(picker, /selectedCollaboratorIds/);
  });
});
