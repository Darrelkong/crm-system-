import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, isNotNull, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { staffReclamationGroupingKey } from "@/lib/notifications/action-state";
import {
  getPendingActionCount,
  getUnreadNotificationCount,
  getWorkItemsAttentionCount,
} from "@/lib/notifications/queries";
import { runReclamationCheck } from "@/lib/reclamation/engine";
import { syncReclamationWorkItems } from "@/lib/reclamation/work-items-sync";

const EPISODE_CUSTOMER = "77777777-7777-7777-7777-777777777701";
const FIXED_NOW = new Date("2026-07-15T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db;
let disposeProxy: (() => Promise<void>) | undefined;
let previousReclaimDays: string | null = null;

function daysAgoIso(days: number): string {
  return new Date(FIXED_NOW.getTime() - days * MS_PER_DAY).toISOString();
}

function makeCustomer(idleDays: number): Customer {
  const anchor = daysAgoIso(idleDays);
  return {
    id: EPISODE_CUSTOMER,
    customerCode: null,
    customerName: "[TEST] Risk episode",
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000444",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    requestedProjectCode: null,
    notes: null,
    salesStage: "negotiation",
    ownerId: SEED_IDS.staffA,
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

async function upsertSetting(key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  if (existing[0]) {
    if (existing[0].value === value) return;
    await db
      .update(schema.systemSettings)
      .set({ value, updatedAt: now })
      .where(eq(schema.systemSettings.key, key));
    return;
  }
  await db.insert(schema.systemSettings).values({ key, value, updatedAt: now });
}

async function readSetting(key: string): Promise<string | null> {
  const row = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  return row[0]?.value ?? null;
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

async function isolateOtherEligibleCustomers(keepIds: string[]): Promise<void> {
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

async function deleteTestData(): Promise<void> {
  await restoreIsolatedCustomers();
  await db
    .delete(schema.reclamationActionItems)
    .where(eq(schema.reclamationActionItems.customerId, EPISODE_CUSTOMER));
  await db
    .delete(schema.reclamationWarningLogs)
    .where(eq(schema.reclamationWarningLogs.customerId, EPISODE_CUSTOMER));
  await db
    .delete(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, SEED_IDS.staffA),
        eq(
          schema.notifications.groupingKey,
          staffReclamationGroupingKey(SEED_IDS.staffA),
        ),
      ),
    );
  await db.delete(schema.customers).where(eq(schema.customers.id, EPISODE_CUSTOMER));
}

describe("risk episode re-entry after rule extension DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    previousReclaimDays = await readSetting("automatic_reclaim_days");
    await upsertSetting("automatic_reclaim_days", "14");
    await upsertSetting("reclaim_warning_days_before", "1");
    await deleteTestData();
  });

  after(async () => {
    await deleteTestData();
    if (previousReclaimDays != null) {
      await upsertSetting("automatic_reclaim_days", previousReclaimDays);
    }
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("creates a new pending episode after 14→60→14 without reviving expired rows", async () => {
    await deleteTestData();
    await db.insert(schema.customers).values(makeCustomer(6));
    await isolateOtherEligibleCustomers([EPISODE_CUSTOMER]);

    await runReclamationCheck(db, FIXED_NOW);
    const firstEpisodes = await db
      .select()
      .from(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, EPISODE_CUSTOMER));
    assert.equal(firstEpisodes.length, 1);
    assert.equal(firstEpisodes[0]?.actionState, "pending");
    const firstKey = firstEpisodes[0]?.riskEpisodeKey;

    await upsertSetting("automatic_reclaim_days", "60");
    await syncReclamationWorkItems(db, FIXED_NOW);

    const afterExtend = await db
      .select()
      .from(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, EPISODE_CUSTOMER));
    assert.equal(afterExtend.length, 1);
    assert.equal(afterExtend[0]?.actionState, "expired");
    assert.equal(afterExtend[0]?.riskEpisodeKey, firstKey);

    await upsertSetting("automatic_reclaim_days", "14");
    await syncReclamationWorkItems(db, FIXED_NOW);

    const afterReentry = await db
      .select()
      .from(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, EPISODE_CUSTOMER))
      .orderBy(asc(schema.reclamationActionItems.createdAt));
    assert.equal(afterReentry.length, 2);
    assert.equal(afterReentry[0]?.actionState, "expired");
    assert.equal(afterReentry[1]?.actionState, "pending");
    assert.notEqual(afterReentry[0]?.riskEpisodeKey, afterReentry[1]?.riskEpisodeKey);
  });

  it("does not re-unread summary when cron reruns with unchanged risk", async () => {
    await deleteTestData();
    await db.insert(schema.customers).values(makeCustomer(6));
    await isolateOtherEligibleCustomers([EPISODE_CUSTOMER]);

    await runReclamationCheck(db, FIXED_NOW);
    const summary = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, SEED_IDS.staffA),
          eq(
            schema.notifications.groupingKey,
            staffReclamationGroupingKey(SEED_IDS.staffA),
          ),
        ),
      )
      .limit(1);
    assert.equal(summary[0]?.isRead, 0);

    await db
      .update(schema.notifications)
      .set({ isRead: 1 })
      .where(eq(schema.notifications.id, summary[0]!.id));

    await runReclamationCheck(db, FIXED_NOW);
    const after = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, summary[0]!.id))
      .limit(1);
    assert.equal(after[0]?.isRead, 1);
    assert.equal(after[0]?.actionState, "pending");
  });

  it("re-unreads summary when risk customer set changes with same counts", async () => {
    const customerA = "77777777-7777-7777-7777-777777777711";
    const customerB = "77777777-7777-7777-7777-777777777712";
    const customerC = "77777777-7777-7777-7777-777777777713";
    const customerD = "77777777-7777-7777-7777-777777777714";

    for (const id of [customerA, customerB, customerC, customerD]) {
      await db
        .delete(schema.reclamationActionItems)
        .where(eq(schema.reclamationActionItems.customerId, id));
      await db
        .delete(schema.reclamationWarningLogs)
        .where(eq(schema.reclamationWarningLogs.customerId, id));
      await db.delete(schema.customers).where(eq(schema.customers.id, id));
    }

    const anchor = daysAgoIso(6);
    await db.insert(schema.customers).values({
      ...makeCustomer(6),
      id: customerA,
      customerName: "[TEST] Risk swap A",
      lastValidFollowUpAt: anchor,
      reclamationCycleStartedAt: anchor,
      createdAt: anchor,
      updatedAt: anchor,
    });
    await db.insert(schema.customers).values({
      ...makeCustomer(6),
      id: customerB,
      customerName: "[TEST] Risk swap B",
      lastValidFollowUpAt: anchor,
      reclamationCycleStartedAt: anchor,
      createdAt: anchor,
      updatedAt: anchor,
    });
    await isolateOtherEligibleCustomers([customerA, customerB]);
    await runReclamationCheck(db, FIXED_NOW);

    const summary = await db
      .select()
      .from(schema.notifications)
      .where(
        eq(
          schema.notifications.groupingKey,
          staffReclamationGroupingKey(SEED_IDS.staffA),
        ),
      )
      .limit(1);
    assert.ok(summary[0]);
    assert.equal(summary[0]?.isRead, 0);
    const firstFingerprint = summary[0]?.summaryFingerprint;

    await db
      .update(schema.notifications)
      .set({ isRead: 1 })
      .where(eq(schema.notifications.id, summary[0]!.id));

    await db
      .update(schema.customers)
      .set({ isPinned: 1, pinnedAt: FIXED_NOW.toISOString() })
      .where(inArray(schema.customers.id, [customerA, customerB]));

    const anchorC = daysAgoIso(6);
    await db.insert(schema.customers).values({
      ...makeCustomer(6),
      id: customerC,
      customerName: "[TEST] Risk swap C",
      lastValidFollowUpAt: anchorC,
      reclamationCycleStartedAt: anchorC,
      createdAt: anchorC,
      updatedAt: anchorC,
    });
    await db.insert(schema.customers).values({
      ...makeCustomer(6),
      id: customerD,
      customerName: "[TEST] Risk swap D",
      lastValidFollowUpAt: anchorC,
      reclamationCycleStartedAt: anchorC,
      createdAt: anchorC,
      updatedAt: anchorC,
    });
    await isolateOtherEligibleCustomers([customerC, customerD]);
    await runReclamationCheck(db, FIXED_NOW);

    const after = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, summary[0]!.id))
      .limit(1);
    assert.equal(after[0]?.isRead, 0);
    assert.notEqual(after[0]?.summaryFingerprint, firstFingerprint);
    assert.doesNotMatch(after[0]?.message ?? "", /riskEpisodeKey/i);
    assert.doesNotMatch(
      after[0]?.message ?? "",
      /77777777-7777-7777-7777-7777777777/,
    );

    for (const id of [customerA, customerB, customerC, customerD]) {
      await db
        .delete(schema.reclamationActionItems)
        .where(eq(schema.reclamationActionItems.customerId, id));
      await db
        .delete(schema.reclamationWarningLogs)
        .where(eq(schema.reclamationWarningLogs.customerId, id));
      await db.delete(schema.customers).where(eq(schema.customers.id, id));
    }
  });

  it("does not create a new episode when warningDaysBefore changes", async () => {
    await deleteTestData();
    await db.insert(schema.customers).values(makeCustomer(6));
    await isolateOtherEligibleCustomers([EPISODE_CUSTOMER]);
    await syncReclamationWorkItems(db, FIXED_NOW);

    const before = await db
      .select()
      .from(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, EPISODE_CUSTOMER));
    assert.equal(before.length, 1);

    await upsertSetting("reclaim_warning_days_before", "3");
    await syncReclamationWorkItems(db, FIXED_NOW);

    const after = await db
      .select()
      .from(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, EPISODE_CUSTOMER));
    assert.equal(after.length, 1);
    assert.equal(after[0]?.riskEpisodeKey, before[0]?.riskEpisodeKey);
    assert.equal(after[0]?.actionState, "pending");
  });

  it("does not create a new episode when automatic_reclaim_days is saved with the same value", async () => {
    await deleteTestData();
    await db.insert(schema.customers).values(makeCustomer(6));
    await isolateOtherEligibleCustomers([EPISODE_CUSTOMER]);
    await syncReclamationWorkItems(db, FIXED_NOW);

    const before = await db
      .select()
      .from(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, EPISODE_CUSTOMER));
    assert.equal(before.length, 1);

    await upsertSetting("automatic_reclaim_days", "14");
    await syncReclamationWorkItems(db, FIXED_NOW);

    const after = await db
      .select()
      .from(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, EPISODE_CUSTOMER));
    assert.equal(after.length, 1);
    assert.equal(after[0]?.riskEpisodeKey, before[0]?.riskEpisodeKey);
  });

  it("enforces unique risk_episode_key at the database layer", async () => {
    const episodeKey = "unique-episode-key-test";
    const nowIso = FIXED_NOW.toISOString();
    await db
      .delete(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.riskEpisodeKey, episodeKey));

    await db.insert(schema.reclamationActionItems).values({
      id: "88888888-8888-8888-8888-888888888801",
      userId: SEED_IDS.staffA,
      customerId: EPISODE_CUSTOMER,
      cycleStartedAt: nowIso,
      riskEpisodeKey: episodeKey,
      actionState: "pending",
      riskBand: "within_7",
      idleDays: 6,
      reclaimDaysSnapshot: 14,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await assert.rejects(
      () =>
        db.insert(schema.reclamationActionItems).values({
          id: "88888888-8888-8888-8888-888888888802",
          userId: SEED_IDS.staffA,
          customerId: EPISODE_CUSTOMER,
          cycleStartedAt: nowIso,
          riskEpisodeKey: episodeKey,
          actionState: "pending",
          riskBand: "within_7",
          idleDays: 6,
          reclaimDaysSnapshot: 14,
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
      (error: unknown) => {
        const message =
          error instanceof Error
            ? `${error.message}${error.cause instanceof Error ? error.cause.message : ""}`
            : String(error);
        return /UNIQUE constraint failed/i.test(message);
      },
    );

    await db
      .delete(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.riskEpisodeKey, episodeKey));
  });

  it("re-unreads summary when risk counts change materially", async () => {
    const secondCustomer = "77777777-7777-7777-7777-777777777702";
    await deleteTestData();
    await db
      .delete(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, secondCustomer));
    await db
      .delete(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, secondCustomer));
    await db.delete(schema.customers).where(eq(schema.customers.id, secondCustomer));

    await db.insert(schema.customers).values(makeCustomer(6));
    await isolateOtherEligibleCustomers([EPISODE_CUSTOMER]);
    await runReclamationCheck(db, FIXED_NOW);

    const summary = await db
      .select()
      .from(schema.notifications)
      .where(
        eq(
          schema.notifications.groupingKey,
          staffReclamationGroupingKey(SEED_IDS.staffA),
        ),
      )
      .limit(1);
    await db
      .update(schema.notifications)
      .set({ isRead: 1 })
      .where(eq(schema.notifications.id, summary[0]!.id));

    const secondCustomerAnchor = daysAgoIso(8);
    await db.insert(schema.customers).values({
      ...makeCustomer(8),
      id: secondCustomer,
      customerName: "[TEST] Risk episode 2",
      lastValidFollowUpAt: secondCustomerAnchor,
      reclamationCycleStartedAt: secondCustomerAnchor,
      createdAt: secondCustomerAnchor,
      updatedAt: secondCustomerAnchor,
    });
    await isolateOtherEligibleCustomers([EPISODE_CUSTOMER, secondCustomer]);
    await runReclamationCheck(db, FIXED_NOW);

    const after = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, summary[0]!.id))
      .limit(1);
    assert.equal(after[0]?.isRead, 0);

    await db
      .delete(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, secondCustomer));
    await db
      .delete(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, secondCustomer));
    await db.delete(schema.customers).where(eq(schema.customers.id, secondCustomer));
  });
});

describe("legacy notification retirement counts DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
  });

  after(async () => {
    await db
      .delete(schema.notifications)
      .where(eq(schema.notifications.id, "legacy-count-test-1"));
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("excludes legacy unread warnings from unread, pending, and attention", async () => {
    await db
      .delete(schema.notifications)
      .where(eq(schema.notifications.id, "legacy-count-test-1"));
    await db.insert(schema.notifications).values({
      id: "legacy-count-test-1",
      userId: SEED_IDS.staffA,
      type: "auto_reclaim_warning_day_6",
      title: "legacy",
      message: "legacy",
      isRead: 0,
      actionState: "informational",
      createdAt: FIXED_NOW.toISOString(),
    });

    assert.equal(await getUnreadNotificationCount(db, SEED_IDS.staffA), 0);
    assert.equal(await getPendingActionCount(db, SEED_IDS.staffA), 0);
    assert.equal(await getWorkItemsAttentionCount(db, SEED_IDS.staffA), 0);
  });
});
