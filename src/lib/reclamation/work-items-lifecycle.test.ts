import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  adminReclamationGroupingKey,
  staffReclamationGroupingKey,
} from "@/lib/notifications/action-state";
import { markAllNotificationsRead } from "@/lib/notifications/queries";
import { runReclamationCheck } from "@/lib/reclamation/engine";
import {
  completeReclamationActionItemsForFollowUp,
  expireReclamationActionItems,
  resolveReclamationRiskCustomerIds,
  syncReclamationWorkItems,
} from "@/lib/reclamation/work-items-sync";

const LIFECYCLE_CUSTOMER_A = "66666666-6666-6666-6666-666666666601";
const LIFECYCLE_CUSTOMER_B = "66666666-6666-6666-6666-666666666602";
const TEST_IDS = [LIFECYCLE_CUSTOMER_A, LIFECYCLE_CUSTOMER_B] as const;

const FIXED_NOW = new Date("2026-07-15T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db;
let disposeProxy: (() => Promise<void>) | undefined;
let previousReclaimDays: string | null = null;
let previousDaysBefore: string | null = null;

function daysAgoIso(days: number, now = FIXED_NOW): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

function makeCustomer(
  id: string,
  idleDays: number,
  ownerId = SEED_IDS.staffA,
): Customer {
  const anchor = daysAgoIso(idleDays, FIXED_NOW);
  return {
    id,
    customerCode: null,
    customerName: `[TEST] Work items ${id.slice(-2)}`,
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000333",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    requestedProjectCode: null,
    notes: null,
    salesStage: "negotiation",
    ownerId,
    status: "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    lastFollowUpAt: null,
    lastValidFollowUpAt: anchor,
    nextFollowUpAt: null,
    reclamationCycleStartedAt: anchor,
    reclaimRuleGraceUntil: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    lifecycleCompletionNotes: null,
    preferredName: null,
    gender: null,
    ageRange: null,
    preferredLanguage: null,
    preferredContactMethod: null,
    occupation: null,
    companyName: null,
    jobTitle: null,
    targetCountryOrRegion: null,
    primaryConcern: null,
    createdAt: anchor,
    updatedAt: anchor,
  };
}

const pinnedForIsolation: string[] = [];

async function readSetting(key: string): Promise<string | null> {
  const row = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  return row[0]?.value ?? null;
}

async function upsertSetting(key: string, value: string): Promise<void> {
  const existing = await readSetting(key);
  if (existing == null) {
    await db.insert(schema.systemSettings).values({
      key,
      value,
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await db
    .update(schema.systemSettings)
    .set({ value, updatedAt: new Date().toISOString() })
    .where(eq(schema.systemSettings.key, key));
}

async function deleteTestData(): Promise<void> {
  await restoreIsolatedCustomers();
  for (const id of TEST_IDS) {
    await db
      .delete(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, id));
    await db
      .delete(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, id));
    await db
      .delete(schema.notifications)
      .where(eq(schema.notifications.relatedEntityId, id));
    await db.delete(schema.customers).where(eq(schema.customers.id, id));
  }
  await db
    .delete(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, SEED_IDS.staffA),
        eq(schema.notifications.type, "reclamation.summary.staff"),
      ),
    );
  await db
    .delete(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, SEED_IDS.admin),
        eq(schema.notifications.type, "reclamation.summary.admin"),
      ),
    );
}

async function restoreIsolatedCustomers(): Promise<void> {
  while (pinnedForIsolation.length > 0) {
    const chunk = pinnedForIsolation.splice(0, 40);
    await db
      .update(schema.customers)
      .set({ isPinned: 0, pinnedAt: null })
      .where(inArray(schema.customers.id, chunk));
  }
}

async function isolateOtherEligibleCustomers(
  keepIds: string[],
  _now = FIXED_NOW,
): Promise<void> {
  void _now;
  await restoreIsolatedCustomers();
  const rows = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.status, "active"),
        isNotNull(schema.customers.ownerId),
        eq(schema.customers.isPinned, 0),
      ),
    );
  const others = rows
    .map((row) => row.id)
    .filter((id) => !keepIds.includes(id));
  for (let i = 0; i < others.length; i += 40) {
    const chunk = others.slice(i, i + 40);
    await db
      .update(schema.customers)
      .set({ isPinned: 1, pinnedAt: FIXED_NOW.toISOString() })
      .where(inArray(schema.customers.id, chunk));
    pinnedForIsolation.push(...chunk);
  }
}

describe("reclamation work items lifecycle DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;

    previousReclaimDays = await readSetting("automatic_reclaim_days");
    previousDaysBefore = await readSetting("reclaim_warning_days_before");
    await upsertSetting("automatic_reclaim_days", "14");
    await upsertSetting("reclaim_warning_days_before", "1");
    await deleteTestData();
  });

  after(async () => {
    await deleteTestData();
    if (previousReclaimDays != null) {
      await upsertSetting("automatic_reclaim_days", previousReclaimDays);
    }
    if (previousDaysBefore != null) {
      await upsertSetting("reclaim_warning_days_before", previousDaysBefore);
    }
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("creates one staff summary for multiple at-risk customers", async () => {
    await deleteTestData();
    await db.insert(schema.customers).values(makeCustomer(LIFECYCLE_CUSTOMER_A, 7));
    await db.insert(schema.customers).values(makeCustomer(LIFECYCLE_CUSTOMER_B, 8));
    await isolateOtherEligibleCustomers([...TEST_IDS]);

    await runReclamationCheck(db, FIXED_NOW);

    const summaries = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, SEED_IDS.staffA),
          eq(schema.notifications.groupingKey, staffReclamationGroupingKey(SEED_IDS.staffA)),
          eq(schema.notifications.actionState, "pending"),
        ),
      );
    assert.equal(summaries.length, 1);

    const actionItems = await db
      .select()
      .from(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.actionState, "pending"));
    const testItems = actionItems.filter((row) =>
      TEST_IDS.includes(row.customerId as (typeof TEST_IDS)[number]),
    );
    assert.equal(testItems.length, 2);
  });

  it("does not duplicate summary on cron rerun", async () => {
    await deleteTestData();
    await db.insert(schema.customers).values(makeCustomer(LIFECYCLE_CUSTOMER_A, 7));
    await isolateOtherEligibleCustomers([LIFECYCLE_CUSTOMER_A]);

    await runReclamationCheck(db, FIXED_NOW);
    await runReclamationCheck(db, FIXED_NOW);

    const summaries = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, SEED_IDS.staffA),
          eq(schema.notifications.type, "reclamation.summary.staff"),
        ),
      );
    assert.equal(summaries.length, 1);
  });

  it("completes action items and summary after valid follow-up", async () => {
    await deleteTestData();
    const customer = makeCustomer(LIFECYCLE_CUSTOMER_A, 7);
    await db.insert(schema.customers).values(customer);
    await isolateOtherEligibleCustomers([LIFECYCLE_CUSTOMER_A]);
    await runReclamationCheck(db, FIXED_NOW);

    const followUpId = "77777777-7777-7777-7777-777777777701";
    const freshAnchor = new Date(FIXED_NOW.getTime() + 1000).toISOString();
    await db.insert(schema.followUps).values({
      id: followUpId,
      customerId: LIFECYCLE_CUSTOMER_A,
      userId: SEED_IDS.staffA,
      followUpTime: freshAnchor,
      channel: "call",
      outcome: "connected",
      summary: "Valid manual follow-up",
      content: "Valid manual follow-up",
      isValidFollowUp: 1,
      createdAt: freshAnchor,
    });
    await db
      .update(schema.customers)
      .set({
        lastValidFollowUpAt: freshAnchor,
        reclamationCycleStartedAt: freshAnchor,
        updatedAt: freshAnchor,
      })
      .where(eq(schema.customers.id, LIFECYCLE_CUSTOMER_A));

    await completeReclamationActionItemsForFollowUp(db, {
      customerId: LIFECYCLE_CUSTOMER_A,
      ownerId: SEED_IDS.staffA,
      cycleStartedAt: customer.reclamationCycleStartedAt!,
      followUpId,
      now: new Date(freshAnchor),
    });

    const completed = await db
      .select()
      .from(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, LIFECYCLE_CUSTOMER_A));
    assert.equal(completed[0]?.actionState, "completed");
    assert.equal(completed[0]?.completedFollowUpId, followUpId);

    const summary = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, SEED_IDS.staffA),
          eq(schema.notifications.groupingKey, staffReclamationGroupingKey(SEED_IDS.staffA)),
        ),
      )
      .limit(1);
    assert.equal(summary[0]?.actionState, "completed");
  });

  it("expires pending items when customer leaves risk scope", async () => {
    await deleteTestData();
    await db.insert(schema.customers).values(makeCustomer(LIFECYCLE_CUSTOMER_A, 7));
    await isolateOtherEligibleCustomers([LIFECYCLE_CUSTOMER_A]);
    await runReclamationCheck(db, FIXED_NOW);

    await expireReclamationActionItems(db, {
      customerId: LIFECYCLE_CUSTOMER_A,
      userId: SEED_IDS.staffA,
      reason: "transferred",
      now: FIXED_NOW,
    });

    const item = await db
      .select()
      .from(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, LIFECYCLE_CUSTOMER_A))
      .limit(1);
    assert.equal(item[0]?.actionState, "expired");
    assert.equal(item[0]?.expireReason, "transferred");
  });

  it("staff cannot resolve team risk customer ids", async () => {
    const staffUser = { id: SEED_IDS.staffA, role: "staff" } as User;
    const ids = await resolveReclamationRiskCustomerIds(db, staffUser, "team");
    assert.equal(ids, undefined);
  });

  it("admin receives team summary notification", async () => {
    await deleteTestData();
    await db.insert(schema.customers).values(makeCustomer(LIFECYCLE_CUSTOMER_A, 7));
    await isolateOtherEligibleCustomers([LIFECYCLE_CUSTOMER_A]);
    await syncReclamationWorkItems(db, FIXED_NOW);

    const adminSummary = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, SEED_IDS.admin),
          eq(schema.notifications.groupingKey, adminReclamationGroupingKey()),
          eq(schema.notifications.actionState, "pending"),
        ),
      );
    assert.equal(adminSummary.length, 1);
    assert.equal(adminSummary[0]?.summaryScope, "admin_team");
  });

  it("mark-all-read leaves pending reclamation summaries unread for bulk", async () => {
    await deleteTestData();
    await db.insert(schema.customers).values(makeCustomer(LIFECYCLE_CUSTOMER_A, 7));
    await isolateOtherEligibleCustomers([LIFECYCLE_CUSTOMER_A]);
    await runReclamationCheck(db, FIXED_NOW);

    const infoId = "88888888-8888-8888-8888-888888888801";
    await db.insert(schema.notifications).values({
      id: infoId,
      userId: SEED_IDS.staffA,
      type: "customer.transferred",
      title: "info",
      message: "info",
      isRead: 0,
      actionState: "informational",
      createdAt: FIXED_NOW.toISOString(),
    });

    const result = await markAllNotificationsRead(db, SEED_IDS.staffA);
    assert.ok(result.markedCount >= 1);
    assert.ok(result.retainedCount >= 1);

    const summary = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, SEED_IDS.staffA),
          eq(schema.notifications.type, "reclamation.summary.staff"),
        ),
      )
      .limit(1);
    assert.equal(summary[0]?.actionState, "pending");

    await db.delete(schema.notifications).where(eq(schema.notifications.id, infoId));
  });
});
