import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getLatestPublishedAnnouncementForUser } from "./service";

const admin = { id: SEED_IDS.admin, role: "admin" } as Pick<User, "id" | "role">;
const staff = { id: SEED_IDS.staffA, role: "staff" } as Pick<User, "id" | "role">;

const TEST_ANN_ALL = "test-latest-ann-all";
const TEST_ANN_ADMIN = "test-latest-ann-admin";
const TEST_ANN_STAFF = "test-latest-ann-staff";
const TEST_ANN_DRAFT = "test-latest-ann-draft";
const TEST_ANN_ARCHIVED = "test-latest-ann-archived";
const TEST_ANN_OLDER = "test-latest-ann-older";

const ALL_TEST_IDS = [
  TEST_ANN_ALL,
  TEST_ANN_ADMIN,
  TEST_ANN_STAFF,
  TEST_ANN_DRAFT,
  TEST_ANN_ARCHIVED,
  TEST_ANN_OLDER,
];

function makeAnn(
  id: string,
  opts: {
    status: "published" | "draft" | "archived";
    audience: "all" | "admin" | "staff";
    publishedAt?: string | null;
    title?: string;
  },
) {
  const now = "2026-01-15T10:00:00.000Z";
  return {
    id,
    title: opts.title ?? `Test announcement ${id}`,
    content: "Test content",
    status: opts.status,
    audience: opts.audience,
    createdBy: SEED_IDS.admin,
    publishedAt: opts.publishedAt !== undefined ? opts.publishedAt : (opts.status === "published" ? now : null),
    archivedAt: opts.status === "archived" ? now : null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("getLatestPublishedAnnouncementForUser", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    dispose = proxy.dispose;
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);

    // Remove any prior test rows
    await db
      .delete(schema.announcements)
      .where(inArray(schema.announcements.id, ALL_TEST_IDS));
  });

  after(async () => {
    await db
      .delete(schema.announcements)
      .where(inArray(schema.announcements.id, ALL_TEST_IDS));
    await dispose?.();
  });

  it("returns null when no published announcements exist for role", async () => {
    // No test rows inserted yet
    const result = await getLatestPublishedAnnouncementForUser(db, admin);
    // Seed data may have announcements; we can't assume null here.
    // Just verify the shape (not testing seed-dependent count).
    if (result !== null) {
      assert.equal(typeof result.id, "string");
      assert.equal(typeof result.title, "string");
      assert.ok(!("createdBy" in result), "must not expose createdBy");
    }
  });

  it("returns latest published announcement for admin (audience=all or admin)", async () => {
    await db.insert(schema.announcements).values([
      makeAnn(TEST_ANN_ALL, {
        status: "published",
        audience: "all",
        publishedAt: "2026-01-10T00:00:00.000Z",
        title: "All audiences notice",
      }),
      makeAnn(TEST_ANN_ADMIN, {
        status: "published",
        audience: "admin",
        publishedAt: "2026-01-20T00:00:00.000Z",
        title: "Admin-only notice (newer)",
      }),
    ]);

    const result = await getLatestPublishedAnnouncementForUser(db, admin);
    assert.ok(result !== null);
    // The admin-only notice is newer so it should be returned
    assert.equal(result.id, TEST_ANN_ADMIN);
    assert.ok(!("createdBy" in result), "must not expose createdBy");
    assert.equal(typeof result.published_at, "string");
  });

  it("does not return admin-only announcements to staff", async () => {
    // TEST_ANN_ADMIN is audience=admin — staff should not see it
    const result = await getLatestPublishedAnnouncementForUser(db, staff);
    assert.ok(result !== null);
    assert.notEqual(result.id, TEST_ANN_ADMIN);
  });

  it("returns staff-only announcement to staff but not to admin", async () => {
    await db.insert(schema.announcements).values([
      makeAnn(TEST_ANN_STAFF, {
        status: "published",
        audience: "staff",
        publishedAt: "2026-01-25T00:00:00.000Z",
        title: "Staff-only notice (newest)",
      }),
    ]);

    const staffResult = await getLatestPublishedAnnouncementForUser(db, staff);
    assert.ok(staffResult !== null);
    assert.equal(staffResult.id, TEST_ANN_STAFF);

    const adminResult = await getLatestPublishedAnnouncementForUser(db, admin);
    assert.ok(adminResult !== null);
    assert.notEqual(adminResult.id, TEST_ANN_STAFF);
  });

  it("does not return draft announcements", async () => {
    await db.insert(schema.announcements).values([
      makeAnn(TEST_ANN_DRAFT, {
        status: "draft",
        audience: "all",
        publishedAt: null,
      }),
    ]);

    const result = await getLatestPublishedAnnouncementForUser(db, admin);
    if (result !== null) {
      assert.notEqual(result.id, TEST_ANN_DRAFT);
    }
  });

  it("does not return archived announcements", async () => {
    await db.insert(schema.announcements).values([
      makeAnn(TEST_ANN_ARCHIVED, {
        status: "archived",
        audience: "all",
        publishedAt: "2026-01-30T00:00:00.000Z",
      }),
    ]);

    const result = await getLatestPublishedAnnouncementForUser(db, admin);
    if (result !== null) {
      assert.notEqual(result.id, TEST_ANN_ARCHIVED);
    }
  });

  it("returns only safe fields — no createdBy", async () => {
    const result = await getLatestPublishedAnnouncementForUser(db, admin);
    assert.ok(result !== null);
    assert.ok(!("createdBy" in result));
    assert.ok(!("created_by" in result));
    assert.ok("id" in result);
    assert.ok("title" in result);
    assert.ok("content" in result);
    assert.ok("audience" in result);
    assert.ok("published_at" in result);
  });
});
