import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase, getDb } from "@/lib/db";
import { getCustomerById } from "@/lib/customers/queries";
import { listFollowUpsByCustomerId } from "@/lib/follow-ups/queries";
import { resolveCustomerAccessOptions } from "@/lib/permissions/customers";
import {
  getCustomerTimeline,
  loadActorNamesForCustomer,
  loadTaskAuditsForCustomer,
} from "@/lib/customers/timeline/service";
import type { User } from "../../../../drizzle/schema/users";

const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;

function readTimelineServiceSource(): string {
  return readFileSync("src/lib/customers/timeline/service.ts", "utf8");
}

describe("timeline Phase 2B2 critical path", () => {
  it("loads task audits and actor names in the first Promise.all stage", () => {
    const source = readTimelineServiceSource();
    const stageOneStart = source.indexOf("await Promise.all([");
    const stageOneEnd = source.indexOf("const resolvedFollowUps", stageOneStart);
    const stageOne = source.slice(stageOneStart, stageOneEnd);
    assert.match(stageOne, /loadTaskAuditsForCustomer/);
    assert.match(stageOne, /loadActorNamesForCustomer/);
    assert.doesNotMatch(
      stageOne,
      /const taskIds = tasks\.map/,
    );
    assert.doesNotMatch(source.slice(stageOneEnd), /taskIds\.length > 0/);
  });

  it("supports preloaded follow-ups without issuing a follow-up SELECT", () => {
    const source = readTimelineServiceSource();
    assert.match(source, /preloadedFollowUps/);
    assert.match(
      source,
      /options\?\.preloadedFollowUps !== undefined[\s\S]*Promise\.resolve\(options\.preloadedFollowUps\)/,
    );
  });
});

describe("timeline Phase 2B2 equivalence", () => {
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    const db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    // The disposable serial harness seeds users, not customer history.
    // Preserve the legacy pre-seeded local mode; only populate the isolated fixture.
    if (process.env.CRM_TEST_D1_HTTP_URL) {
      const now = "2026-01-01T00:00:00.000Z";
      await db.insert(schema.customers).values({
        id: SEED_IDS.customerStaffA, customerName: "Synthetic F1 timeline",
        customerType: "individual", source: "other", requestedProjectName: "Synthetic",
        ownerId: SEED_IDS.staffA, status: "active", salesStage: "contacted",
        createdBy: SEED_IDS.admin, updatedBy: SEED_IDS.admin, createdAt: now, updatedAt: now,
      });
      await db.insert(schema.followUps).values({
        id: crypto.randomUUID(), customerId: SEED_IDS.customerStaffA, userId: SEED_IDS.staffA,
        followUpTime: now, channel: "phone", outcome: "contact_made", summary: "Synthetic summary",
        nextAction: "Synthetic saved next action", content: "Synthetic summary", createdAt: now,
      });
      const taskId = crypto.randomUUID();
      await db.insert(schema.tasks).values({
        id: taskId, customerId: SEED_IDS.customerStaffA, assignedTo: SEED_IDS.staffA,
        createdBy: SEED_IDS.staffB, title: "Synthetic follow-up", type: "follow_up",
        status: "open", createdAt: now, updatedAt: now,
      });
      await db.insert(schema.auditLogs).values({
        id: crypto.randomUUID(), userId: SEED_IDS.staffB, action: "task.created",
        entityType: "task", entityId: taskId, createdAt: now,
      });
    }
  });

  after(async () => {
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("loadTaskAuditsForCustomer matches taskIds-based audit query", async () => {
    const db = getDb();
    const customerId = SEED_IDS.customerStaffA;
    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.customerId, customerId));
    const taskIds = tasks.map((task) => task.id);

    const legacyAudits =
      taskIds.length > 0
        ? await db
            .select()
            .from(schema.auditLogs)
            .where(
              and(
                eq(schema.auditLogs.entityType, "task"),
                inArray(schema.auditLogs.entityId, taskIds),
              ),
            )
            .orderBy(desc(schema.auditLogs.createdAt))
        : [];

    const customerTaskAudits = await loadTaskAuditsForCustomer(db, customerId);

    assert.deepEqual(
      customerTaskAudits.map((row) => row.id).sort(),
      legacyAudits.map((row) => row.id).sort(),
    );
    assert.deepEqual(
      customerTaskAudits.map((row) => ({
        id: row.id,
        action: row.action,
        entityId: row.entityId,
        createdAt: row.createdAt,
      })),
      legacyAudits.map((row) => ({
        id: row.id,
        action: row.action,
        entityId: row.entityId,
        createdAt: row.createdAt,
      })),
    );
  });

  it("loadActorNamesForCustomer resolves same actor names as event-derived IDs", async () => {
    const db = getDb();
    const customer = await getCustomerById(SEED_IDS.customerStaffA);
    assert.ok(customer);
    const accessOptions = await resolveCustomerAccessOptions(
      db,
      adminUser,
      customer.id,
    );

    const timeline = await getCustomerTimeline(
      db,
      adminUser,
      customer,
      accessOptions,
    );
    const actorMap = await loadActorNamesForCustomer(
      db,
      customer.id,
      customer.createdBy,
    );

    for (const item of timeline.items) {
      if (item.actorIsSystem) continue;
      if (!item.actorName) continue;
      const names = [...actorMap.values()];
      assert.ok(
        names.includes(item.actorName),
        `missing actor name ${item.actorName}`,
      );
    }
  });

  it("timeline output is unchanged when follow-ups are preloaded", async () => {
    const db = getDb();
    const customer = await getCustomerById(SEED_IDS.customerStaffA);
    assert.ok(customer);
    const accessOptions = await resolveCustomerAccessOptions(
      db,
      adminUser,
      customer.id,
    );

    const standalone = await getCustomerTimeline(
      db,
      adminUser,
      customer,
      accessOptions,
    );
    const followUps = await listFollowUpsByCustomerId(customer.id);
    const preloaded = await getCustomerTimeline(
      db,
      adminUser,
      customer,
      accessOptions,
      { preloadedFollowUps: followUps },
    );

    assert.deepEqual(
      standalone.items.map((item) => ({
        id: item.id,
        type: item.type,
        occurredAt: item.occurredAt,
        titleKey: item.titleKey,
        sensitive: item.sensitive,
      })),
      preloaded.items.map((item) => ({
        id: item.id,
        type: item.type,
        occurredAt: item.occurredAt,
        titleKey: item.titleKey,
        sensitive: item.sensitive,
      })),
    );
    assert.equal(standalone.accessLevel, preloaded.accessLevel);
  });
});
