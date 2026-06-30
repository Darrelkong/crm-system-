import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  getNotificationHref,
  listNotificationsForUser,
} from "./queries";

const TEST_NOTIFICATION_EXISTING =
  "n9999999-9999-9999-9999-999999999901";
const TEST_NOTIFICATION_MISSING =
  "n9999999-9999-9999-9999-999999999902";
const DELETED_CUSTOMER_ID = "99999999-9999-9999-9999-999999999901";

/** Ensure inserted rows sort ahead of seed / prior test notifications. */
function newestCreatedAt(): string {
  return new Date(Date.now() + 60_000).toISOString();
}

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

async function deleteTestNotifications() {
  await db
    .delete(schema.notifications)
    .where(
      inArray(schema.notifications.id, [
        TEST_NOTIFICATION_EXISTING,
        TEST_NOTIFICATION_MISSING,
      ]),
    );
}

describe("listNotificationsForUser related entity missing flags", () => {
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
    await deleteTestNotifications();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("marks missing customer notifications and keeps existing customer links", async () => {
    await deleteTestNotifications();

    const ts = newestCreatedAt();

    await db.insert(schema.notifications).values([
      {
        id: TEST_NOTIFICATION_EXISTING,
        userId: SEED_IDS.staffA,
        type: "customer_auto_reclaimed",
        title: "Existing customer notification",
        message: "Still linked",
        relatedEntityType: "customer",
        relatedEntityId: SEED_IDS.customerStaffA,
        isRead: 0,
        createdAt: ts,
      },
      {
        id: TEST_NOTIFICATION_MISSING,
        userId: SEED_IDS.staffA,
        type: "customer_auto_reclaimed",
        title: "Deleted customer notification",
        message: "Orphan link",
        relatedEntityType: "customer",
        relatedEntityId: DELETED_CUSTOMER_ID,
        isRead: 0,
        createdAt: ts,
      },
    ]);

    const items = await listNotificationsForUser(db, SEED_IDS.staffA, {
      limit: 50,
    });

    const existing = items.find((item) => item.id === TEST_NOTIFICATION_EXISTING);
    const missing = items.find((item) => item.id === TEST_NOTIFICATION_MISSING);

    assert.ok(existing);
    assert.equal(existing.related_entity_missing, undefined);
    assert.equal(
      getNotificationHref(existing, "staff"),
      `/customers/${SEED_IDS.customerStaffA}`,
    );

    assert.ok(missing);
    assert.equal(missing.related_entity_missing, true);
    assert.equal(getNotificationHref(missing, "staff"), null);
  });
});
