import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import {
  enforceStaffAccessEmailBinding,
  STAFF_ACCESS_EMAIL_BINDING_OUTCOMES,
} from "@/lib/auth/staff-access-email-binding";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let dispose: (() => Promise<void>) | undefined;
const createdUserIds: string[] = [];

async function createStaff(
  overrides: Partial<{
    isActive: number;
    deletedAt: string | null;
    lockedUntil: string | null;
    cloudflareAccessEmail: string | null;
  }> = {},
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  createdUserIds.push(id);
  await db.insert(schema.users).values({
    id,
    email: `${id}@crm.test`,
    displayName: "Binding Test Staff",
    passwordHash: "test-password-hash",
    role: "staff",
    isActive: overrides.isActive ?? 1,
    failedLoginAttempts: 0,
    lockedUntil: overrides.lockedUntil ?? null,
    mustChangePassword: 0,
    passwordChangedAt: null,
    passwordResetAt: null,
    initialDeviceAutoApprovalEligible: 0,
    deletedAt: overrides.deletedAt ?? null,
    cloudflareAccessEmail: overrides.cloudflareAccessEmail ?? null,
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

async function readBoundEmail(userId: string): Promise<string | null> {
  const [user] = await db
    .select({ cloudflareAccessEmail: schema.users.cloudflareAccessEmail })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return user?.cloudflareAccessEmail ?? null;
}

function uniqueAccessEmail(label = "staff"): string {
  return `${label}-${crypto.randomUUID()}@gmail.com`;
}

describe("Staff Cloudflare Access Email binding", () => {
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
        .delete(schema.users)
        .where(inArray(schema.users.id, createdUserIds.splice(0)));
    }
    bindTestDatabase(null);
    await dispose?.();
    dispose = undefined;
  });

  it("binds an unbound Staff account after credentials are verified", async () => {
    const user = await createStaff();
    const accessEmail = uniqueAccessEmail("daniel");
    const outcome = await enforceStaffAccessEmailBinding(db, {
      userId: user.id,
      role: user.role,
      isActive: user.isActive,
      deletedAt: user.deletedAt,
      lockedUntil: user.lockedUntil,
      storedAccessEmail: user.cloudflareAccessEmail,
      loginEmail: user.email,
      verifiedAccessEmail: ` ${accessEmail.toUpperCase()} `,
    });

    assert.equal(
      outcome,
      STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.BOUND_NOW,
    );
    assert.equal(await readBoundEmail(user.id), accessEmail);
  });

  it("does not reach binding before the CRM password validity gate", () => {
    const loginSource = readFileSync(
      new URL("../../app/api/auth/login/route.ts", import.meta.url),
      "utf8",
    );
    const passwordCheck = loginSource.indexOf(
      "const valid = await verifyPassword(password, user.passwordHash);",
    );
    const invalidPasswordReturn = loginSource.indexOf(
      "return Response.json({ error: LOGIN_INVALID_CREDENTIALS }, { status: 401 });",
    );
    const bindingCall = loginSource.indexOf(
      "enforceStaffAccessEmailBinding(db",
    );

    assert.ok(passwordCheck >= 0);
    assert.ok(invalidPasswordReturn > passwordCheck);
    assert.ok(bindingCall > invalidPasswordReturn);
  });

  it("keeps Access identity server-derived and separates Admin from Staff", () => {
    const loginSource = readFileSync(
      new URL("../../app/api/auth/login/route.ts", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(loginSource, /body\.(?:accessEmail|cloudflareAccessEmail)/);
    assert.match(
      loginSource,
      /if \(user\.role === "admin" && !accessCheckSkipped\)/,
    );
    assert.match(
      loginSource,
      /if \(user\.role === "staff" && !accessCheckSkipped\)/,
    );
  });

  it("does not bind when no verified Access email exists", async () => {
    const user = await createStaff();
    const outcome = await enforceStaffAccessEmailBinding(db, {
      userId: user.id,
      role: user.role,
      isActive: user.isActive,
      deletedAt: user.deletedAt,
      lockedUntil: user.lockedUntil,
      storedAccessEmail: user.cloudflareAccessEmail,
      loginEmail: user.email,
      verifiedAccessEmail: null,
    });

    assert.equal(
      outcome,
      STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.INVALID_ACCESS_EMAIL,
    );
    assert.equal(await readBoundEmail(user.id), null);
  });

  it("allows legacy same-email mode without creating a binding", async () => {
    const user = await createStaff();
    const outcome = await enforceStaffAccessEmailBinding(db, {
      userId: user.id,
      role: user.role,
      isActive: user.isActive,
      deletedAt: user.deletedAt,
      lockedUntil: user.lockedUntil,
      storedAccessEmail: user.cloudflareAccessEmail,
      loginEmail: user.email,
      verifiedAccessEmail: user.email,
    });

    assert.equal(
      outcome,
      STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.LEGACY_MATCH_UNBOUND,
    );
    assert.equal(await readBoundEmail(user.id), null);
  });

  it("allows a normalized existing match", async () => {
    const accessEmail = uniqueAccessEmail("match");
    const user = await createStaff({
      cloudflareAccessEmail: accessEmail,
    });
    const outcome = await enforceStaffAccessEmailBinding(db, {
      userId: user.id,
      role: user.role,
      isActive: user.isActive,
      deletedAt: user.deletedAt,
      lockedUntil: user.lockedUntil,
      storedAccessEmail: user.cloudflareAccessEmail,
      loginEmail: user.email,
      verifiedAccessEmail: ` ${accessEmail.toUpperCase()} `,
    });

    assert.equal(
      outcome,
      STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ALREADY_BOUND_MATCH,
    );
  });

  it("rejects an existing mismatch without overwriting it", async () => {
    const accessEmail = uniqueAccessEmail("bound");
    const user = await createStaff({
      cloudflareAccessEmail: accessEmail,
    });
    const outcome = await enforceStaffAccessEmailBinding(db, {
      userId: user.id,
      role: user.role,
      isActive: user.isActive,
      deletedAt: user.deletedAt,
      lockedUntil: user.lockedUntil,
      storedAccessEmail: user.cloudflareAccessEmail,
      loginEmail: user.email,
      verifiedAccessEmail: uniqueAccessEmail("other"),
    });

    assert.equal(
      outcome,
      STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ACCESS_EMAIL_MISMATCH,
    );
    assert.equal(await readBoundEmail(user.id), accessEmail);
  });

  it("rejects an Access Email already bound to another Staff user", async () => {
    const accessEmail = uniqueAccessEmail("duplicate");
    const first = await createStaff({
      cloudflareAccessEmail: accessEmail,
    });
    const second = await createStaff();
    const outcome = await enforceStaffAccessEmailBinding(db, {
      userId: second.id,
      role: second.role,
      isActive: second.isActive,
      deletedAt: second.deletedAt,
      lockedUntil: second.lockedUntil,
      storedAccessEmail: second.cloudflareAccessEmail,
      loginEmail: second.email,
      verifiedAccessEmail: accessEmail,
    });

    assert.equal(
      outcome,
      STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ACCESS_EMAIL_ALREADY_USED,
    );
    assert.equal(await readBoundEmail(first.id), accessEmail);
    assert.equal(await readBoundEmail(second.id), null);
  });

  it("does not bind Admin accounts", async () => {
    const user = await createStaff();
    const outcome = await enforceStaffAccessEmailBinding(db, {
      userId: user.id,
      role: "admin",
      isActive: user.isActive,
      deletedAt: user.deletedAt,
      lockedUntil: user.lockedUntil,
      storedAccessEmail: user.cloudflareAccessEmail,
      loginEmail: user.email,
      verifiedAccessEmail: "admin@example.com",
    });

    assert.equal(outcome, STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.NOT_STAFF);
    assert.equal(await readBoundEmail(user.id), null);
  });

  it("rejects inactive, deleted, or locked Staff before binding", async () => {
    for (const overrides of [
      { isActive: 0 },
      { deletedAt: new Date().toISOString() },
      { lockedUntil: new Date().toISOString() },
    ]) {
      const user = await createStaff(overrides);
      const outcome = await enforceStaffAccessEmailBinding(db, {
        userId: user.id,
        role: user.role,
        isActive: user.isActive,
        deletedAt: user.deletedAt,
        lockedUntil: user.lockedUntil,
        storedAccessEmail: user.cloudflareAccessEmail,
        loginEmail: user.email,
        verifiedAccessEmail: "staff@example.com",
      });
      assert.equal(
        outcome,
        STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ACCOUNT_NOT_ELIGIBLE,
      );
      assert.equal(await readBoundEmail(user.id), null);
    }
  });

  it("handles concurrent first binding for one user idempotently", async () => {
    const user = await createStaff();
    const accessEmail = uniqueAccessEmail("concurrent");
    const input = {
      userId: user.id,
      role: user.role,
      isActive: user.isActive,
      deletedAt: user.deletedAt,
      lockedUntil: user.lockedUntil,
      storedAccessEmail: user.cloudflareAccessEmail,
      loginEmail: user.email,
      verifiedAccessEmail: accessEmail,
    } as const;
    const outcomes = await Promise.all([
      enforceStaffAccessEmailBinding(db, input),
      enforceStaffAccessEmailBinding(db, input),
    ]);

    assert.equal(await readBoundEmail(user.id), accessEmail);
    assert.ok(
      outcomes.every(
        (outcome) =>
          outcome === STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.BOUND_NOW ||
          outcome === STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ALREADY_BOUND_MATCH,
      ),
    );
  });

  it("allows only one user to win a concurrent duplicate identity race", async () => {
    const first = await createStaff();
    const second = await createStaff();
    const accessEmail = uniqueAccessEmail("race");
    const base = (user: typeof first) => ({
      userId: user.id,
      role: user.role,
      isActive: user.isActive,
      deletedAt: user.deletedAt,
      lockedUntil: user.lockedUntil,
      storedAccessEmail: user.cloudflareAccessEmail,
      loginEmail: user.email,
      verifiedAccessEmail: accessEmail,
    });
    const outcomes = await Promise.all([
      enforceStaffAccessEmailBinding(db, base(first)),
      enforceStaffAccessEmailBinding(db, base(second)),
    ]);

    const bound = [await readBoundEmail(first.id), await readBoundEmail(second.id)];
    assert.equal(bound.filter((email) => email === accessEmail).length, 1);
    assert.equal(
      outcomes.filter(
        (outcome) =>
          outcome === STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.BOUND_NOW ||
          outcome === STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ALREADY_BOUND_MATCH,
      ).length,
      1,
    );
    assert.ok(
      outcomes.includes(
        STAFF_ACCESS_EMAIL_BINDING_OUTCOMES.ACCESS_EMAIL_ALREADY_USED,
      ),
    );
  });
});
