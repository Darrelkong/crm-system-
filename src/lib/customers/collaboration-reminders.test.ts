import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  runCollaborationFollowUpReminderCheck,
  listCollaborationReminderCandidates,
  COLLABORATION_REMINDER_NOTIFICATION_TYPE,
} from "./collaboration-reminders";

const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa71";
const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";

describe("collaboration follow-up reminders", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
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
      .delete(schema.notifications)
      .where(
        and(
          eq(schema.notifications.relatedEntityId, CUSTOMER_ID),
          eq(
            schema.notifications.type,
            COLLABORATION_REMINDER_NOTIFICATION_TYPE,
          ),
        ),
      );
    await db
      .delete(schema.followUps)
      .where(eq(schema.followUps.customerId, CUSTOMER_ID));
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, CUSTOMER_ID));
    await db.delete(schema.customers).where(eq(schema.customers.id, CUSTOMER_ID));
    await db.insert(schema.customers).values({
      id: CUSTOMER_ID,
      customerCode: "GOV-REMINDER",
      customerName: "Reminder fixture",
      source: "other",
      ownerId: SEED_IDS.staffA,
      status: "active",
      createdBy: SEED_IDS.staffA,
      createdAt: FIXTURE_CREATED_AT,
      updatedAt: FIXTURE_CREATED_AT,
    });
    await db.insert(schema.customerAssignees).values([
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb71",
        customerId: CUSTOMER_ID,
        userId: SEED_IDS.staffA,
        role: "primary",
        assignedBy: SEED_IDS.staffA,
        assignedAt: FIXTURE_CREATED_AT,
        createdAt: FIXTURE_CREATED_AT,
        updatedAt: FIXTURE_CREATED_AT,
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb72",
        customerId: CUSTOMER_ID,
        userId: SEED_IDS.staffB,
        role: "collaborator",
        assignedBy: SEED_IDS.staffA,
        assignedAt: FIXTURE_CREATED_AT,
        createdAt: FIXTURE_CREATED_AT,
        updatedAt: FIXTURE_CREATED_AT,
      },
    ]);
  });

  after(async () => {
    await db
      .delete(schema.notifications)
      .where(eq(schema.notifications.relatedEntityId, CUSTOMER_ID));
    await db
      .delete(schema.followUps)
      .where(eq(schema.followUps.customerId, CUSTOMER_ID));
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, CUSTOMER_ID));
    await db.delete(schema.customers).where(eq(schema.customers.id, CUSTOMER_ID));
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("delivers one reminder per interval to the current owner and collaborators", async () => {
    await db.insert(schema.followUps).values({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccc71",
      customerId: CUSTOMER_ID,
      userId: SEED_IDS.staffB,
      followUpTime: "2026-01-05T00:00:00.000Z",
      channel: "phone",
      outcome: "connected",
      summary: "Fixture follow-up",
      content: "Fixture follow-up",
      isValidFollowUp: 1,
      createdAt: "2026-01-05T00:00:00.000Z",
    });

    const atDayTen = await listCollaborationReminderCandidates(
      db,
      new Date("2026-01-15T00:00:00.000Z"),
    );
    assert.equal(atDayTen.length, 1);
    assert.equal(atDayTen[0]?.daysWithoutFollowUp, 10);

    const first = await runCollaborationFollowUpReminderCheck(
      db,
      new Date("2026-01-15T00:00:00.000Z"),
    );
    assert.equal(first.notificationCount, 2);
    const second = await runCollaborationFollowUpReminderCheck(
      db,
      new Date("2026-01-15T00:00:00.000Z"),
    );
    assert.equal(second.notificationCount, 0);

    const atDayTwenty = await runCollaborationFollowUpReminderCheck(
      db,
      new Date("2026-01-25T00:00:00.000Z"),
    );
    assert.equal(atDayTwenty.notificationCount, 2);
  });

  it("does not notify a collaborator after the relationship is removed", async () => {
    await db
      .delete(schema.customerAssignees)
      .where(
        and(
          eq(schema.customerAssignees.customerId, CUSTOMER_ID),
          eq(schema.customerAssignees.userId, SEED_IDS.staffB),
        ),
      );
    await db
      .delete(schema.notifications)
      .where(eq(schema.notifications.relatedEntityId, CUSTOMER_ID));

    const result = await runCollaborationFollowUpReminderCheck(
      db,
      new Date("2026-02-01T00:00:00.000Z"),
    );
    assert.equal(result.notificationCount, 0);
    const recipients = await db
      .select({ userId: schema.notifications.userId })
      .from(schema.notifications)
      .where(eq(schema.notifications.relatedEntityId, CUSTOMER_ID));
    assert.deepEqual(recipients.map((row) => row.userId), []);
  });
});
