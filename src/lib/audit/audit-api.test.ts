import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { getAuditLogsForAdmin } from "@/lib/audit/audit-api";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { AuthError } from "@/lib/permissions/auth";
import {
  AUDIT_LOG_DEFAULT_LIMIT,
  AUDIT_LOG_MAX_LIMIT,
  listAuditLogCreatedAtKeys,
  listAuditLogsForAdmin,
} from "@/lib/audit/queries";

const TEST_AUDIT_IDS = [
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa06",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa07",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa08",
] as const;

const TEST_DELETED_USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa99";

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staff = { id: SEED_IDS.staffA, role: "staff" } as User;

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

async function deleteTestAudits() {
  await db
    .delete(schema.auditLogs)
    .where(inArray(schema.auditLogs.id, [...TEST_AUDIT_IDS]));
  await db
    .delete(schema.users)
    .where(eq(schema.users.id, TEST_DELETED_USER_ID));
}

async function seedTestAudits() {
  await deleteTestAudits();

  await db.insert(schema.users).values({
    id: TEST_DELETED_USER_ID,
    email: "deleted-audit-test@crm.local",
    displayName: "Deleted Audit User",
    role: "staff",
    passwordHash: "test",
    isActive: 0,
    mustChangePassword: 0,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: "2026-06-30T09:00:00.000Z",
    updatedAt: "2026-06-30T09:00:00.000Z",
    deletedAt: "2026-06-30T09:30:00.000Z",
  });

  await db.insert(schema.auditLogs).values([
    {
      id: TEST_AUDIT_IDS[0],
      userId: SEED_IDS.admin,
      action: "audit.test.alpha",
      entityType: "customer",
      entityId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01",
      ipAddress: "127.0.0.1",
      userAgent: "audit-test-agent",
      metadata: JSON.stringify({ note: "alpha" }),
      createdAt: "2026-06-30T10:00:00.000Z",
    },
    {
      id: TEST_AUDIT_IDS[1],
      userId: SEED_IDS.staffA,
      action: "audit.test.beta",
      entityType: "user",
      entityId: SEED_IDS.staffA,
      ipAddress: "127.0.0.2",
      userAgent: "audit-test-agent",
      metadata: JSON.stringify({ count: 2 }),
      createdAt: "2026-06-30T11:00:00.000Z",
    },
    {
      id: TEST_AUDIT_IDS[2],
      userId: null,
      action: "audit.test.gamma",
      entityType: "session",
      entityId: null,
      ipAddress: null,
      userAgent: null,
      metadata: "{not-json",
      createdAt: "2026-06-30T12:00:00.000Z",
    },
    {
      id: TEST_AUDIT_IDS[3],
      userId: SEED_IDS.admin,
      action: "audit.test.delta",
      entityType: "customer",
      entityId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02",
      ipAddress: "127.0.0.3",
      userAgent: "audit-test-agent",
      metadata: null,
      createdAt: "2026-07-01T08:00:00.000Z",
    },
    {
      id: TEST_AUDIT_IDS[4],
      userId: TEST_DELETED_USER_ID,
      action: "audit.test.epsilon",
      entityType: "customer",
      entityId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03",
      ipAddress: "127.0.0.4",
      userAgent: "audit-test-agent",
      metadata: JSON.stringify({ deletedUser: true }),
      createdAt: "2026-07-01T09:00:00.000Z",
    },
    {
      id: TEST_AUDIT_IDS[5],
      userId: SEED_IDS.admin,
      action: "audit.test.cursor",
      entityType: "customer",
      entityId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb04",
      ipAddress: "127.0.0.1",
      userAgent: "audit-test-agent",
      metadata: null,
      createdAt: "2026-06-30T20:00:00.000Z",
    },
    {
      id: TEST_AUDIT_IDS[6],
      userId: SEED_IDS.admin,
      action: "audit.test.cursor",
      entityType: "customer",
      entityId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb05",
      ipAddress: "127.0.0.1",
      userAgent: "audit-test-agent",
      metadata: null,
      createdAt: "2026-06-30T19:00:00.000Z",
    },
    {
      id: TEST_AUDIT_IDS[7],
      userId: SEED_IDS.admin,
      action: "audit.test.cursor",
      entityType: "customer",
      entityId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb06",
      ipAddress: "127.0.0.1",
      userAgent: "audit-test-agent",
      metadata: null,
      createdAt: "2026-06-30T18:00:00.000Z",
    },
  ]);
}

before(async () => {
  const proxy = await getPlatformProxy({
    configPath: "./wrangler.jsonc",
  });
  db = drizzle(proxy.env.DB, { schema });
  bindTestDatabase(db);
  disposeProxy = proxy.dispose;
  await seedTestAudits();
});

after(async () => {
  await deleteTestAudits();
  bindTestDatabase(null);
  await disposeProxy?.();
});

describe("admin audit log list API", () => {
  it("allows admin to list audit logs", async () => {
    const result = await getAuditLogsForAdmin(admin, db, {
      action: "audit.test.delta",
      limit: 10,
    });
    assert.equal(result.ok, true);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.action, "audit.test.delta");
    assert.equal(result.items[0]?.userName, "系统管理员");
    assert.equal(result.items[0]?.userEmail, "admin@crm.local");
  });

  it("rejects staff with 403", async () => {
    await assert.rejects(
      () => getAuditLogsForAdmin(staff, db, { limit: 10 }),
      (error: unknown) => {
        assert.ok(error instanceof AuthError);
        assert.equal(error.status, 403);
        assert.equal(error.auditAction, "permission.denied.admin_required");
        return true;
      },
    );
  });

  it("filters by action", async () => {
    const result = await listAuditLogsForAdmin(db, {
      action: "audit.test.beta",
      limit: 10,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.action, "audit.test.beta");
  });

  it("filters by entityType and entityId", async () => {
    const result = await listAuditLogsForAdmin(db, {
      entityType: "customer",
      entityId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01",
      limit: 10,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.id, TEST_AUDIT_IDS[0]);
  });

  it("filters by date range", async () => {
    const result = await listAuditLogsForAdmin(db, {
      action: "audit.test.gamma",
      dateFrom: "2026-06-30T11:30:00.000Z",
      dateTo: "2026-06-30T23:59:59.999Z",
      limit: 10,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.id, TEST_AUDIT_IDS[2]);
  });

  it("filters by userId", async () => {
    const result = await listAuditLogsForAdmin(db, {
      userId: SEED_IDS.staffA,
      action: "audit.test.beta",
      limit: 10,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.id, TEST_AUDIT_IDS[1]);
  });

  it("uses default limit 50 and caps at 100", async () => {
    const keys = await listAuditLogCreatedAtKeys(db, {});
    assert.ok(keys.length <= AUDIT_LOG_DEFAULT_LIMIT);

    const capped = await listAuditLogCreatedAtKeys(db, { limit: 500 });
    assert.ok(capped.length <= AUDIT_LOG_MAX_LIMIT);
  });

  it("orders by createdAt DESC", async () => {
    const result = await listAuditLogsForAdmin(db, {
      action: "audit.test.cursor",
      limit: 10,
    });
    assert.equal(result.items.length, 3);
    assert.equal(result.items[0]?.id, TEST_AUDIT_IDS[5]);
    assert.equal(result.items[1]?.id, TEST_AUDIT_IDS[6]);
    assert.equal(result.items[2]?.id, TEST_AUDIT_IDS[7]);
  });

  it("parses metadata JSON and tolerates malformed metadata", async () => {
    const valid = await listAuditLogsForAdmin(db, {
      action: "audit.test.alpha",
      limit: 1,
    });
    assert.deepEqual(valid.items[0]?.metadata, { note: "alpha" });

    const malformed = await listAuditLogsForAdmin(db, {
      action: "audit.test.gamma",
      limit: 1,
    });
    assert.equal(malformed.items[0]?.metadata, null);
  });

  it("returns records when userId is null or user is soft-deleted", async () => {
    const nullUser = await listAuditLogsForAdmin(db, {
      action: "audit.test.gamma",
      limit: 1,
    });
    assert.equal(nullUser.items[0]?.userId, null);
    assert.equal(nullUser.items[0]?.userName, null);
    assert.equal(nullUser.items[0]?.userEmail, null);

    const deletedUser = await listAuditLogsForAdmin(db, {
      action: "audit.test.epsilon",
      limit: 1,
    });
    assert.equal(deletedUser.items[0]?.userId, TEST_DELETED_USER_ID);
    assert.equal(deletedUser.items[0]?.userName, "Deleted Audit User");
    assert.equal(deletedUser.items[0]?.userEmail, "deleted-audit-test@crm.local");
  });

  it("supports cursor pagination", async () => {
    const pageOne = await listAuditLogsForAdmin(db, {
      action: "audit.test.cursor",
      limit: 2,
    });
    assert.equal(pageOne.items.length, 2);
    assert.equal(pageOne.items[0]?.id, TEST_AUDIT_IDS[5]);
    assert.equal(pageOne.items[1]?.id, TEST_AUDIT_IDS[6]);
    assert.ok(pageOne.nextCursor);

    const pageTwo = await listAuditLogsForAdmin(db, {
      action: "audit.test.cursor",
      limit: 2,
      cursor: pageOne.nextCursor!,
    });
    assert.equal(pageTwo.items.length, 1);
    assert.equal(pageTwo.items[0]?.id, TEST_AUDIT_IDS[7]);
    assert.equal(pageTwo.nextCursor, null);

    const onlyAlpha = await listAuditLogsForAdmin(db, {
      action: "audit.test.alpha",
      limit: 1,
    });
    assert.equal(onlyAlpha.nextCursor, null);
    assert.equal(onlyAlpha.items[0]?.id, TEST_AUDIT_IDS[0]);
  });

  it("does not mutate existing audit rows", async () => {
    const before = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.id, TEST_AUDIT_IDS[0]))
      .limit(1);
    await listAuditLogsForAdmin(db, { limit: 5 });
    const after = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.id, TEST_AUDIT_IDS[0]))
      .limit(1);
    assert.deepEqual(after, before);
  });
});
