import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { RECLAMATION_AUDIT_ACTIONS } from "@/lib/reclamation/constants";
import { runReclamationCheck } from "@/lib/reclamation/engine";
import { isReclamationWarningLogUniqueConflictError } from "@/lib/reclamation/warning-log-unique";
import { createNotification } from "@/lib/notifications/service";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const WARNING_TEST_ID = "55555555-5555-5555-5555-555555555501";
const WARNING_CYCLE_ID = "55555555-5555-5555-5555-555555555502";
const WARNING_UNIQUE_ID = "55555555-5555-5555-5555-555555555503";

const TEST_CUSTOMER_IDS = [
  WARNING_TEST_ID,
  WARNING_CYCLE_ID,
  WARNING_UNIQUE_ID,
] as const;

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

function makeWarningCustomer(
  id: string,
  idleDays: number,
  overrides: Partial<Customer> = {},
): Customer {
  const anchor = daysAgoIso(idleDays, FIXED_NOW);
  return {
    id,
    customerCode: null,
    customerName: `[TEST] Warning delivery ${id.slice(-2)}`,
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000222",
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
    reclamationCycleStartedAt: overrides.reclamationCycleStartedAt ?? anchor,
    reclaimRuleGraceUntil: overrides.reclaimRuleGraceUntil ?? null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    pinnedSource: null,
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
    ...overrides,
  };
}

const pinnedForIsolation: string[] = [];

async function isolateOtherEligibleCustomers(
  keepCustomerIds: string[],
  _now = FIXED_NOW,
) {
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
    .filter((id) => !keepCustomerIds.includes(id));
  for (let i = 0; i < others.length; i += 40) {
    const chunk = others.slice(i, i + 40);
    await db
      .update(schema.customers)
      .set({ isPinned: 1, pinnedAt: FIXED_NOW.toISOString() })
      .where(inArray(schema.customers.id, chunk));
    pinnedForIsolation.push(...chunk);
  }
}

async function restoreIsolatedCustomers() {
  while (pinnedForIsolation.length > 0) {
    const chunk = pinnedForIsolation.splice(0, 40);
    await db
      .update(schema.customers)
      .set({ isPinned: 0, pinnedAt: null })
      .where(inArray(schema.customers.id, chunk));
  }
}

async function deleteTestData() {
  await restoreIsolatedCustomers();
  for (const customerId of TEST_CUSTOMER_IDS) {
    await db
      .delete(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, customerId));
    await db
      .delete(schema.notifications)
      .where(eq(schema.notifications.relatedEntityId, customerId));
    await db
      .delete(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, customerId));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, customerId));
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, customerId));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, customerId));
  }
  await db
    .delete(schema.notifications)
    .where(
      and(
        inArray(schema.notifications.userId, [SEED_IDS.staffA, SEED_IDS.admin]),
        inArray(schema.notifications.type, [
          "reclamation.summary.staff",
          "reclamation.summary.admin",
        ]),
      ),
    );
}

async function upsertSetting(key: string, value: string) {
  const existing = await db
    .select({ key: schema.systemSettings.key })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(schema.systemSettings)
      .set({ value, updatedAt: new Date().toISOString() })
      .where(eq(schema.systemSettings.key, key));
  } else {
    await db.insert(schema.systemSettings).values({
      key,
      value,
      updatedAt: new Date().toISOString(),
    });
  }
}

async function readSetting(key: string): Promise<string | null> {
  const rows = await db
    .select({ value: schema.systemSettings.value })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

describe("isReclamationWarningLogUniqueConflictError", () => {
  it("matches only reclamation_warning_logs unique signatures", () => {
    assert.equal(
      isReclamationWarningLogUniqueConflictError(
        new Error(
          "UNIQUE constraint failed: reclamation_warning_logs.customer_id, reclamation_warning_logs.warning_type, reclamation_warning_logs.warning_date",
        ),
      ),
      true,
    );
    assert.equal(
      isReclamationWarningLogUniqueConflictError(
        new Error("UNIQUE constraint failed: idx_reclamation_warning_unique"),
      ),
      true,
    );
    assert.equal(
      isReclamationWarningLogUniqueConflictError(
        new Error(
          "UNIQUE constraint failed: customer_assignees.customer_id, customer_assignees.user_id",
        ),
      ),
      false,
    );
    assert.equal(
      isReclamationWarningLogUniqueConflictError(
        new Error("UNIQUE constraint failed: notifications.id"),
      ),
      false,
    );
    assert.equal(
      isReclamationWarningLogUniqueConflictError(new Error("D1_ERROR: boom")),
      false,
    );
  });
});

describe("reclaim warning delivery hardening wiring", () => {
  it("sendReclaimWarning writes warning log only; runReclamationCheck syncs work items", () => {
    const src = read("src/lib/reclamation/engine.ts");
    const fn = src.slice(
      src.indexOf("async function sendReclaimWarning"),
      src.indexOf("async function autoReclaimCustomer"),
    );
    assert.match(fn, /db\.batch\(/);
    assert.match(fn, /insert\(schema\.reclamationWarningLogs\)/);
    assert.match(fn, /isReclamationWarningLogUniqueConflictError/);
    assert.doesNotMatch(
      fn,
      /await db\.insert\(schema\.reclamationWarningLogs\)/,
    );
    assert.doesNotMatch(fn, /await createNotification\(/);
    assert.doesNotMatch(fn, /buildCreateNotificationStatement/);
    assert.match(
      fn,
      /await writeAuditLog/,
    );
    assert.doesNotMatch(fn, /createNotificationOnce/);
    assert.doesNotMatch(fn, /syncReclamationWorkItems/);

    const runCheck = src.slice(src.indexOf("export async function runReclamationCheck"));
    assert.match(runCheck, /await sendReclaimWarning/);
    assert.match(runCheck, /await syncReclamationWorkItems/);
  });

  it("entries share runReclamationCheck milestone model", () => {
    assert.match(
      read("workers/reclamation-cron.ts"),
      /runReclamationCheck/,
    );
    assert.match(
      read("src/lib/reclamation/run.ts"),
      /runReclamationCheck/,
    );
    assert.match(
      read("src/app/api/admin/reclamation/run/route.ts"),
      /runReclamationJob/,
    );

    const engine = read("src/lib/reclamation/engine.ts");
    assert.match(engine, /resolveNextWarningMilestone/);
    assert.doesNotMatch(
      engine.slice(engine.indexOf("export async function runReclamationCheck")),
      /reclaimWarningThresholdDays/,
    );

    const dryRun = read("src/lib/reclamation/collaborative-dry-run.ts");
    assert.doesNotMatch(dryRun, /reclamationWarningLogs|createNotification/);
  });

  it("notification service exposes batchable statement builder", () => {
    const src = read("src/lib/notifications/service.ts");
    assert.match(src, /export function buildCreateNotificationStatement/);
    const builder = src.slice(
      src.indexOf("export function buildCreateNotificationStatement"),
      src.indexOf("export async function createNotification"),
    );
    assert.doesNotMatch(builder, /await /);
    assert.match(builder, /insert\(schema\.notifications\)/);
    assert.match(
      src.slice(src.indexOf("export async function createNotification")),
      /buildCreateNotificationStatement/,
    );
    assert.match(src, /export async function createNotificationOnce/);
  });
});

describe("reclaim warning delivery hardening DB", () => {
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

  it("creates warning log and work-item summary; same-day rerun skips", async () => {
    await deleteTestData();
    await db.insert(schema.customers).values(makeWarningCustomer(WARNING_TEST_ID, 7));
    await isolateOtherEligibleCustomers([WARNING_TEST_ID]);

    const first = await runReclamationCheck(db, FIXED_NOW);
    assert.equal(first.warningsCount, 1);
    assert.equal(first.warningsDay7Count, 0);
    assert.ok(first.affectedCustomerIds.includes(WARNING_TEST_ID));

    const logs = await db
      .select()
      .from(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, WARNING_TEST_ID));
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.warningType, "day_6");
    assert.equal(logs[0]?.warningDate, "2026-07-15");
    assert.equal(logs[0]?.warningMilestone, 7);
    assert.equal(logs[0]?.reclaimDaysSnapshot, 14);

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
    assert.equal(summaries[0]?.actionState, "pending");
    assert.equal(summaries[0]?.isRead, 0);

    const actionItems = await db
      .select()
      .from(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, WARNING_TEST_ID));
    assert.equal(actionItems.length, 1);
    assert.equal(actionItems[0]?.actionState, "pending");

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, WARNING_TEST_ID),
          eq(schema.auditLogs.action, RECLAMATION_AUDIT_ACTIONS.warning),
        ),
      );
    assert.equal(audits.length, 1);
    const auditMeta = JSON.parse(audits[0]?.metadata ?? "{}") as {
      timelineMessage?: string;
      reclaimDaysSnapshot?: number;
    };
    assert.equal(auditMeta.reclaimDaysSnapshot, 14);
    assert.match(String(auditMeta.timelineMessage ?? ""), /当时自动释放规则：14 天/);

    const second = await runReclamationCheck(db, FIXED_NOW);
    assert.equal(second.warningsCount, 0);

    const logsAfter = await db
      .select()
      .from(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, WARNING_TEST_ID));
    assert.equal(logsAfter.length, 1);
    const summariesAfter = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, SEED_IDS.staffA),
          eq(schema.notifications.type, "reclamation.summary.staff"),
        ),
      );
    assert.equal(summariesAfter.length, 1);
  });

  it("catches up missed day-7 warning when cron runs on day 8", async () => {
    await deleteTestData();
    await db
      .insert(schema.customers)
      .values(makeWarningCustomer(WARNING_TEST_ID, 8));
    await isolateOtherEligibleCustomers([WARNING_TEST_ID]);

    const result = await runReclamationCheck(db, FIXED_NOW);
    assert.equal(result.warningsCount, 1);

    const logs = await db
      .select()
      .from(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, WARNING_TEST_ID));
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.warningMilestone, 7);
  });

  it("new valid follow-up starts a new cycle that can warn again", async () => {
    await deleteTestData();
    await db
      .insert(schema.customers)
      .values(makeWarningCustomer(WARNING_CYCLE_ID, 7));
    await isolateOtherEligibleCustomers([WARNING_CYCLE_ID]);

    const first = await runReclamationCheck(db, FIXED_NOW);
    assert.equal(first.warningsCount, 1);

    const freshAnchor = new Date(FIXED_NOW.getTime() + 1000).toISOString();
    const laterNow = new Date(new Date(freshAnchor).getTime() + 7 * MS_PER_DAY);
    await db
      .update(schema.customers)
      .set({
        lastValidFollowUpAt: freshAnchor,
        reclamationCycleStartedAt: freshAnchor,
        updatedAt: freshAnchor,
      })
      .where(eq(schema.customers.id, WARNING_CYCLE_ID));

    await isolateOtherEligibleCustomers([WARNING_CYCLE_ID], laterNow);
    const second = await runReclamationCheck(db, laterNow);
    assert.equal(second.warningsCount, 1);

    const logs = await db
      .select()
      .from(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, WARNING_CYCLE_ID));
    assert.equal(logs.length, 2);

    const actionItems = await db
      .select()
      .from(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, WARNING_CYCLE_ID));
    assert.equal(actionItems.length, 2);
    const pendingItems = actionItems.filter((row) => row.actionState === "pending");
    assert.equal(pendingItems.length, 1);
    const expiredItems = actionItems.filter((row) => row.actionState === "expired");
    assert.equal(expiredItems.length, 1);
  });

  it("milestone dedup in same cycle skips without duplicate notification or audit", async () => {
    await deleteTestData();
    await db
      .insert(schema.customers)
      .values(makeWarningCustomer(WARNING_UNIQUE_ID, 7));
    await isolateOtherEligibleCustomers([WARNING_UNIQUE_ID]);

    const first = await runReclamationCheck(db, FIXED_NOW);
    assert.equal(first.warningsCount, 1);

    const raced = await runReclamationCheck(db, FIXED_NOW);
    assert.equal(raced.warningsCount, 0);

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

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, WARNING_UNIQUE_ID),
          eq(schema.auditLogs.action, RECLAMATION_AUDIT_ACTIONS.warning),
        ),
      );
    assert.equal(audits.length, 1);

    const logs = await db
      .select()
      .from(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, WARNING_UNIQUE_ID));
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.warningMilestone, 7);
  });

  it("createNotification still works via statement builder for non-batch callers", async () => {
    const id = await createNotification(db, {
      userId: SEED_IDS.admin,
      type: "backup_failed",
      titleKey: "notificationTypes.backup_failed",
      messageKey: "notificationMessages.backupFailed",
      relatedEntityType: "backup_job",
      relatedEntityId: "warning-delivery-builder-smoke",
    });
    assert.ok(id);
    await db
      .delete(schema.notifications)
      .where(eq(schema.notifications.id, id));
  });
});
