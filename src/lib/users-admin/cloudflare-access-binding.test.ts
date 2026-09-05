import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import {
  resetStaffCloudflareAccessBinding,
  UserAdminError,
} from "@/lib/users-admin/service";
import type { User } from "../../../drizzle/schema/users";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let dispose: (() => Promise<void>) | undefined;
const createdUserIds: string[] = [];

async function createTestUser(role: User["role"], accessEmail: string | null) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  createdUserIds.push(id);
  await db.insert(schema.users).values({
    id,
    email: `${id}@example.com`,
    displayName: role === "admin" ? "Binding Admin" : "Binding Staff",
    passwordHash: "test-hash",
    role,
    isActive: 1,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mustChangePassword: 0,
    passwordChangedAt: null,
    passwordResetAt: null,
    initialDeviceAutoApprovalEligible: 0,
    deletedAt: null,
    cloudflareAccessEmail: accessEmail,
    createdAt: now,
    updatedAt: now,
  });
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  assert.ok(user);
  return user;
}

describe("Admin Staff Access binding management", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
    db = drizzle(proxy.env.DB, { schema });
    dispose = proxy.dispose;
    bindTestDatabase(db);
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await db
        .delete(schema.auditLogs)
        .where(
          inArray(schema.auditLogs.userId, createdUserIds),
        );
      await db
        .delete(schema.sessions)
        .where(inArray(schema.sessions.userId, createdUserIds));
      await db
        .delete(schema.users)
        .where(inArray(schema.users.id, createdUserIds.splice(0)));
    }
    bindTestDatabase(null);
    await dispose?.();
    dispose = undefined;
  });

  it("resets only Staff binding, revokes target sessions, and audits the reset", async () => {
    const admin = await createTestUser("admin", null);
    const staff = await createTestUser("staff", "staff.personal@example.com");
    const { sessionId } = await createSession(
      staff.id,
      new Request("https://crm.example.com/login"),
      "binding-test-device",
    );

    await resetStaffCloudflareAccessBinding(admin, staff.id, {
      ipAddress: "192.0.2.10",
      userAgent: "binding-test",
    });

    const [updatedStaff] = await db
      .select({
        cloudflareAccessEmail: schema.users.cloudflareAccessEmail,
        role: schema.users.role,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(eq(schema.users.id, staff.id))
      .limit(1);
    assert.equal(updatedStaff?.cloudflareAccessEmail, null);
    assert.equal(updatedStaff?.role, "staff");
    assert.equal(updatedStaff?.email, staff.email);

    const [session] = await db
      .select({ revokedAt: schema.sessions.revokedAt })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    assert.ok(session?.revokedAt);

    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "STAFF_ACCESS_BINDING_RESET"),
          eq(schema.auditLogs.entityId, staff.id),
        ),
      )
      .orderBy(schema.auditLogs.createdAt)
      .limit(1);
    assert.equal(audit?.userId, admin.id);
    assert.equal(audit?.entityType, "user");
    assert.match(audit?.metadata ?? "", /source/);
    assert.match(audit?.metadata ?? "", /previousAccessEmail/);
    assert.doesNotMatch(audit?.metadata ?? "", /password|token|jwt/i);
  });

  it("rejects non-Admin actors and Admin targets", async () => {
    const admin = await createTestUser("admin", null);
    const staff = await createTestUser("staff", "staff.personal-2@example.com");

    await assert.rejects(
      () =>
        resetStaffCloudflareAccessBinding(staff, staff.id, {
          ipAddress: null,
          userAgent: null,
        }),
      (error: unknown) =>
        error instanceof UserAdminError &&
        error.status === 403 &&
        error.code === "admin_required",
    );

    await assert.rejects(
      () =>
        resetStaffCloudflareAccessBinding(admin, admin.id, {
          ipAddress: null,
          userAgent: null,
        }),
      (error: unknown) =>
        error instanceof UserAdminError &&
        error.code === "invalid_target",
    );

    const [unchanged] = await db
      .select({ cloudflareAccessEmail: schema.users.cloudflareAccessEmail })
      .from(schema.users)
      .where(eq(schema.users.id, staff.id))
      .limit(1);
    assert.equal(unchanged?.cloudflareAccessEmail, "staff.personal-2@example.com");
  });
});
