import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { QUICK_ENTRY_ENTRY_METHOD } from "@/lib/public-pool/quick-entry-entry-method";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  countOpenFirstContactTasks,
  enforceFirstContactFollowUpGate,
  evaluateFirstContactFollowUpGate,
} from "@/lib/follow-ups/first-contact-gate";
import { assertCanAddFollowUp, PermissionError } from "@/lib/permissions/customers";

const CUSTOMER_ID = "f3111111-1111-1111-1111-111111111111";
const TASK_OPEN = "f3111111-1111-1111-1111-1111111111t1";
const TASK_COMPLETED_OLD = "f3111111-1111-1111-1111-1111111111t2";
const TASK_COMPLETED_NEW = "f3111111-1111-1111-1111-1111111111t3";
const FOLLOW_UP_ID = "f3111111-1111-1111-1111-1111111111f1";

const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;
const admin = { id: SEED_IDS.admin, role: "admin" } as User;

const CYCLE_1_CLAIM = "2026-07-30T10:00:00.000Z";
const CYCLE_1_COMPLETE = "2026-07-30T12:00:00.000Z";
const CYCLE_2_CLAIM = "2026-08-01T10:00:00.000Z";
const FIXED_NOW = "2026-08-01T11:00:00.000Z";

let db: ReturnType<typeof drizzle<typeof schema>>;
let dispose: (() => Promise<void>) | undefined;

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    customerCode: null,
    customerName: "[TEST] Phase3 Gate",
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800001111",
    wechatId: null,
    email: null,
    source: "xiaohongshu",
    entryMethod: QUICK_ENTRY_ENTRY_METHOD,
    sourceRemark: null,
    requestedProjectName: "测试项目",
    requestedProjectCode: null,
    notes: "Quick entry note only",
    salesStage: "contacted",
    ownerId: SEED_IDS.staffA,
    status: "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: SEED_IDS.staffA,
    claimedAt: CYCLE_1_CLAIM,
    poolLeftAt: CYCLE_1_CLAIM,
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    createdAt: CYCLE_1_CLAIM,
    updatedAt: CYCLE_1_CLAIM,
    ...overrides,
  } as Customer;
}

async function cleanup() {
  await db.delete(schema.followUps).where(eq(schema.followUps.customerId, CUSTOMER_ID));
  await db.delete(schema.tasks).where(eq(schema.tasks.customerId, CUSTOMER_ID));
  await db.delete(schema.customers).where(eq(schema.customers.id, CUSTOMER_ID));
}

describe("first contact follow-up gate", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy();
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("CASE A: normal customer with no first_contact is allowed", async () => {
    await cleanup();
    await db.insert(schema.customers).values(
      makeCustomer({
        source: "referral",
        entryMethod: null,
      }),
    );

    const customer = makeCustomer({ source: "referral", entryMethod: null });
    const result = await evaluateFirstContactFollowUpGate({
      db,
      customer,
      actor: staffA,
    });
    assert.equal(result.allowed, true);
  });

  it("CASE B: staff Quick Entry claimed with open first_contact is blocked", async () => {
    await cleanup();
    await db.insert(schema.customers).values(makeCustomer());
    await db.insert(schema.tasks).values({
      id: TASK_OPEN,
      customerId: CUSTOMER_ID,
      assignedTo: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      title: "首次联系客户：测试",
      type: "first_contact",
      status: "open",
      dueAt: FIXED_NOW,
      createdAt: CYCLE_1_CLAIM,
      updatedAt: CYCLE_1_CLAIM,
    });

    const result = await evaluateFirstContactFollowUpGate({
      db,
      customer: makeCustomer(),
      actor: staffA,
    });
    assert.equal(result.allowed, false);
    if (result.allowed) return;
    assert.equal(result.reason, "FIRST_CONTACT_REQUIRED");
    assert.equal(result.firstContactTaskId, TASK_OPEN);
  });

  it("CASE C: current-cycle completed first_contact allows follow-up", async () => {
    await cleanup();
    await db.insert(schema.customers).values(makeCustomer());
    await db.insert(schema.tasks).values({
      id: TASK_COMPLETED_NEW,
      customerId: CUSTOMER_ID,
      assignedTo: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      title: "首次联系客户：测试",
      type: "first_contact",
      status: "completed",
      completedAt: CYCLE_1_COMPLETE,
      dueAt: CYCLE_1_CLAIM,
      createdAt: CYCLE_1_CLAIM,
      updatedAt: CYCLE_1_COMPLETE,
    });

    const result = await evaluateFirstContactFollowUpGate({
      db,
      customer: makeCustomer(),
      actor: staffA,
    });
    assert.equal(result.allowed, true);
  });

  it("CASE D: Quick Entry with existing follow-up is allowed even if first_contact incomplete", async () => {
    await cleanup();
    await db.insert(schema.customers).values(makeCustomer());
    await db.insert(schema.tasks).values({
      id: TASK_OPEN,
      customerId: CUSTOMER_ID,
      assignedTo: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      title: "首次联系客户：测试",
      type: "first_contact",
      status: "open",
      dueAt: FIXED_NOW,
      createdAt: CYCLE_1_CLAIM,
      updatedAt: CYCLE_1_CLAIM,
    });
    await db.insert(schema.followUps).values({
      id: FOLLOW_UP_ID,
      customerId: CUSTOMER_ID,
      userId: SEED_IDS.staffA,
      followUpTime: CYCLE_1_COMPLETE,
      channel: "phone",
      outcome: "contact_made",
      summary: "已有正式跟进记录",
      customerIntent: "意向",
      nextFollowUpAt: null,
      nextAction: "继续跟进客户并保持联系",
      isValidFollowUp: 1,
      content: "已有正式跟进记录",
      createdAt: CYCLE_1_COMPLETE,
    });

    const result = await evaluateFirstContactFollowUpGate({
      db,
      customer: makeCustomer(),
      actor: staffA,
    });
    assert.equal(result.allowed, true);
  });

  it("CASE E: legacy Quick Entry with incomplete first_contact is blocked", async () => {
    await cleanup();
    await db.insert(schema.customers).values(
      makeCustomer({
        source: "public_pool_quick_entry",
        entryMethod: null,
      }),
    );
    await db.insert(schema.tasks).values({
      id: TASK_OPEN,
      customerId: CUSTOMER_ID,
      assignedTo: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      title: "首次联系客户：测试",
      type: "first_contact",
      status: "open",
      dueAt: FIXED_NOW,
      createdAt: CYCLE_1_CLAIM,
      updatedAt: CYCLE_1_CLAIM,
    });

    const result = await evaluateFirstContactFollowUpGate({
      db,
      customer: makeCustomer({
        source: "public_pool_quick_entry",
        entryMethod: null,
      }),
      actor: staffA,
    });
    assert.equal(result.allowed, false);
  });

  it("CASE F: admin Quick Entry with incomplete first_contact is allowed", async () => {
    await cleanup();
    await db.insert(schema.customers).values(makeCustomer());
    await db.insert(schema.tasks).values({
      id: TASK_OPEN,
      customerId: CUSTOMER_ID,
      assignedTo: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      title: "首次联系客户：测试",
      type: "first_contact",
      status: "open",
      dueAt: FIXED_NOW,
      createdAt: CYCLE_1_CLAIM,
      updatedAt: CYCLE_1_CLAIM,
    });

    const result = await evaluateFirstContactFollowUpGate({
      db,
      customer: makeCustomer(),
      actor: admin,
    });
    assert.equal(result.allowed, true);
  });

  it("CASE G: public pool Quick Entry preserves existing permission behavior", async () => {
    const poolCustomer = makeCustomer({
      status: "public_pool",
      ownerId: null,
      claimedBy: null,
      claimedAt: null,
      poolLeftAt: null,
    });

    const gate = await evaluateFirstContactFollowUpGate({
      db,
      customer: poolCustomer,
      actor: staffA,
    });
    assert.equal(gate.allowed, true);

    assert.throws(
      () => assertCanAddFollowUp(staffA, poolCustomer),
      (err: unknown) => err instanceof PermissionError && err.status === 403,
    );
  });

  it("CASE I/J: missing first_contact auto-upserts once and remains blocked", async () => {
    await cleanup();
    await db.insert(schema.customers).values(makeCustomer());

    const first = await enforceFirstContactFollowUpGate({
      db,
      customer: makeCustomer(),
      actor: staffA,
      now: FIXED_NOW,
    });
    assert.equal(first.allowed, false);
    if (first.allowed) return;
    assert.ok(first.firstContactTaskId);
    assert.equal(await countOpenFirstContactTasks(db, CUSTOMER_ID), 1);

    const second = await enforceFirstContactFollowUpGate({
      db,
      customer: makeCustomer(),
      actor: staffA,
      now: FIXED_NOW,
    });
    assert.equal(second.allowed, false);
    if (second.allowed) return;
    assert.equal(second.firstContactTaskId, first.firstContactTaskId);
    assert.equal(await countOpenFirstContactTasks(db, CUSTOMER_ID), 1);
  });

  it("CASE K: completing repaired task allows next follow-up", async () => {
    await cleanup();
    await db.insert(schema.customers).values(makeCustomer());

    const blocked = await enforceFirstContactFollowUpGate({
      db,
      customer: makeCustomer(),
      actor: staffA,
      now: FIXED_NOW,
    });
    assert.equal(blocked.allowed, false);
    if (blocked.allowed) return;

    await db
      .update(schema.tasks)
      .set({
        status: "completed",
        completedAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      })
      .where(eq(schema.tasks.id, blocked.firstContactTaskId!));

    const allowed = await evaluateFirstContactFollowUpGate({
      db,
      customer: makeCustomer(),
      actor: staffA,
    });
    assert.equal(allowed.allowed, true);
  });

  it("CASE L: prior claim-cycle completion does not unlock new claim cycle", async () => {
    await cleanup();
    await db.insert(schema.customers).values(
      makeCustomer({
        ownerId: SEED_IDS.staffB,
        claimedBy: SEED_IDS.staffB,
        claimedAt: CYCLE_2_CLAIM,
        poolLeftAt: CYCLE_2_CLAIM,
      }),
    );
    await db.insert(schema.tasks).values({
      id: TASK_COMPLETED_OLD,
      customerId: CUSTOMER_ID,
      assignedTo: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      title: "Cycle 1 completed",
      type: "first_contact",
      status: "completed",
      completedAt: CYCLE_1_COMPLETE,
      dueAt: CYCLE_1_CLAIM,
      createdAt: CYCLE_1_CLAIM,
      updatedAt: CYCLE_1_COMPLETE,
    });
    await db.insert(schema.tasks).values({
      id: TASK_OPEN,
      customerId: CUSTOMER_ID,
      assignedTo: SEED_IDS.staffB,
      createdBy: SEED_IDS.staffB,
      title: "Cycle 2 open",
      type: "first_contact",
      status: "open",
      dueAt: FIXED_NOW,
      createdAt: CYCLE_2_CLAIM,
      updatedAt: CYCLE_2_CLAIM,
    });

    const result = await evaluateFirstContactFollowUpGate({
      db,
      customer: makeCustomer({
        ownerId: SEED_IDS.staffB,
        claimedBy: SEED_IDS.staffB,
        claimedAt: CYCLE_2_CLAIM,
        poolLeftAt: CYCLE_2_CLAIM,
      }),
      actor: staffB,
    });
    assert.equal(result.allowed, false);
  });

  it("CASE M: Quick Entry notes alone do not count as formal follow-up", async () => {
    await cleanup();
    await db.insert(schema.customers).values(
      makeCustomer({
        notes: "initialFollowUpNote stored as customer notes only",
      }),
    );
    await db.insert(schema.tasks).values({
      id: TASK_OPEN,
      customerId: CUSTOMER_ID,
      assignedTo: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
      title: "首次联系客户：测试",
      type: "first_contact",
      status: "open",
      dueAt: FIXED_NOW,
      createdAt: CYCLE_1_CLAIM,
      updatedAt: CYCLE_1_CLAIM,
    });

    const result = await evaluateFirstContactFollowUpGate({
      db,
      customer: makeCustomer({
        notes: "initialFollowUpNote stored as customer notes only",
      }),
      actor: staffA,
    });
    assert.equal(result.allowed, false);
  });
});

describe("first contact follow-up gate route wiring", () => {
  it("POST route enforces gate before follow-up insert", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "src/app/api/customers/[id]/follow-ups/route.ts",
      ),
      "utf8",
    );
    const insertIdx = src.indexOf("db.insert(schema.followUps)");
    const enforceIdx = src.indexOf("enforceFirstContactFollowUpGate");
    assert.ok(enforceIdx > 0);
    assert.ok(insertIdx > enforceIdx);
    assert.match(src, /FIRST_CONTACT_REQUIRED/);
  });
});
