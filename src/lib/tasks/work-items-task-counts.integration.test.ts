import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase, getDb } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  countOpenWorkItemTasks,
  countWorkItemTasks,
  getTaskDueBounds,
  loadWorkItemSettings,
} from "@/lib/tasks/work-items-query";
import { countWorkItemTasksLegacy } from "@/lib/tasks/work-items-task-counts-legacy";
import {
  getWorkItemsInstrumentation,
  resetWorkItemsInstrumentation,
} from "@/lib/tasks/work-items-instrumentation";
import { getEffectiveSettings } from "@/lib/settings/effective";
import type { User } from "../../../drizzle/schema/users";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

const FIXED_NOW = new Date("2026-08-08T12:00:00.000Z");
const staffUser = { id: SEED_IDS.staffA, role: "staff" } as User;
const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;
const otherStaff = { id: SEED_IDS.staffB, role: "staff" } as User;

const TASK_IDS = [
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa06",
];

const TEST_CUSTOMER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb901";

async function cleanupTasks(): Promise<void> {
  await db.delete(schema.tasks).where(inArray(schema.tasks.id, TASK_IDS));
  await db
    .delete(schema.customers)
    .where(eq(schema.customers.id, TEST_CUSTOMER));
}

async function insertTask(
  id: string,
  assignedTo: string,
  status: "open" | "completed" | "cancelled",
  dueAt: string | null,
): Promise<void> {
  const nowIso = FIXED_NOW.toISOString();
  await db.insert(schema.tasks).values({
    id,
    customerId: TEST_CUSTOMER,
    assignedTo,
    createdBy: SEED_IDS.admin,
    title: `[TEST WI] ${id.slice(-2)}`,
    type: "other",
    status,
    dueAt,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

async function ensureCustomer(): Promise<void> {
  const nowIso = FIXED_NOW.toISOString();
  await db
    .insert(schema.customers)
    .values({
      id: TEST_CUSTOMER,
      customerName: "[TEST WI] customer",
      nameStatus: "confirmed",
      customerType: "individual",
      phoneCountryCode: "+86",
      phone: "13800009001",
      source: "referral",
      salesStage: "lead",
      ownerId: SEED_IDS.staffA,
      status: "active",
      createdBy: SEED_IDS.admin,
      updatedBy: SEED_IDS.admin,
      isPinned: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoNothing();
}

describe("work items task count consolidation DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await cleanupTasks();
  });

  after(async () => {
    await cleanupTasks();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  async function assertParity(
    user: User,
    options: { staffId?: string | null } = {},
  ): Promise<void> {
    const settings = await getEffectiveSettings(db);
    const legacy = await countWorkItemTasksLegacy(user, {
      ...options,
      now: FIXED_NOW,
      settings,
    });
    const consolidated = await countWorkItemTasks(user, {
      ...options,
      now: FIXED_NOW,
      settings,
    });
    assert.deepEqual(consolidated, legacy);
  }

  it("matches legacy counts for staff with mixed fixture", async () => {
    await cleanupTasks();
    await ensureCustomer();
    const settings = await getEffectiveSettings(db);
    const { nowIso, tomorrowStart } = getTaskDueBounds(
      FIXED_NOW,
      settings.businessTimezone,
    );

    await insertTask(TASK_IDS[0]!, SEED_IDS.staffA, "open", null);
    await insertTask(TASK_IDS[1]!, SEED_IDS.staffA, "open", nowIso);
    await insertTask(
      TASK_IDS[2]!,
      SEED_IDS.staffA,
      "open",
      new Date(new Date(tomorrowStart).getTime() - 1).toISOString(),
    );
    await insertTask(
      TASK_IDS[3]!,
      SEED_IDS.staffA,
      "open",
      new Date(new Date(nowIso).getTime() - 1).toISOString(),
    );
    await insertTask(TASK_IDS[4]!, SEED_IDS.staffA, "completed", nowIso);
    await insertTask(TASK_IDS[5]!, SEED_IDS.staffB, "open", nowIso);

    await assertParity(staffUser);
    await assertParity(adminUser);
    await assertParity(adminUser, { staffId: SEED_IDS.staffA });
    await assertParity(adminUser, { staffId: SEED_IDS.staffB });
  });

  it("records one physical task-count query per consolidated count", async () => {
    resetWorkItemsInstrumentation();
    await countWorkItemTasks(staffUser, { now: FIXED_NOW });
    const instrumentation = getWorkItemsInstrumentation();
    assert.equal(instrumentation.workItemTaskCountPhysicalLoads, 1);
  });

  it("open badge count matches consolidated open count", async () => {
    await cleanupTasks();
    await ensureCustomer();
    const settings = await getEffectiveSettings(db);
    const { nowIso } = getTaskDueBounds(FIXED_NOW, settings.businessTimezone);
    await insertTask(TASK_IDS[0]!, SEED_IDS.staffA, "open", nowIso);
    await insertTask(TASK_IDS[1]!, SEED_IDS.staffA, "completed", nowIso);

    const openBadge = await countOpenWorkItemTasks(staffUser);
    const full = await countWorkItemTasks(staffUser, {
      now: FIXED_NOW,
      settings,
    });
    assert.equal(openBadge, full.open);
  });

  it("shares one settings load across list and count on Tasks tab path", async () => {
    resetWorkItemsInstrumentation();
    const settingsPromise = loadWorkItemSettings(getDb());
    await Promise.all([
      countWorkItemTasks(staffUser, {
        now: FIXED_NOW,
        settings: settingsPromise,
      }),
      countWorkItemTasks(staffUser, {
        now: FIXED_NOW,
        settings: settingsPromise,
      }),
    ]);
    const instrumentation = getWorkItemsInstrumentation();
    assert.equal(instrumentation.workItemSettingsPhysicalLoads, 1);
  });
});
