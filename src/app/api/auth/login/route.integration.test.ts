import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
} from "jose";
import * as schema from "../../../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import {
  resetAccessJwtJwksCache,
  setAccessJwtTestDeps,
} from "@/lib/auth/access-jwt";
import { handlePostLogin } from "@/app/api/auth/login/route";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
type LoginCookieStore = NonNullable<Parameters<typeof handlePostLogin>[1]>;

let db: TestDb;
let dispose: (() => Promise<void>) | undefined;
let privateKey: CryptoKey;
let publicJwk: JWK;
const createdUserIds: string[] = [];
let requestNumber = 0;
const requestIpPrefix = crypto.getRandomValues(new Uint8Array(1))[0]! % 200 + 1;

const TEAM_DOMAIN = "https://login-test.cloudflareaccess.com";
const AUDIENCE = "login-route-integration";

async function signAccessJwt(email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email,
    iat: now,
    exp: now + 600,
    iss: TEAM_DOMAIN,
    aud: AUDIENCE,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "login-route-test" })
    .sign(privateKey);
}

function cookieStore(): LoginCookieStore {
  return {
    set() {
      // The route only needs a writable cookie store; assertions use D1.
    },
  } as unknown as LoginCookieStore;
}

async function createUser(input: {
  role: "admin" | "staff";
  email?: string;
  accessEmail?: string | null;
  isActive?: number;
  deletedAt?: string | null;
  lockedUntil?: string | null;
  failedLoginAttempts?: number;
}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  createdUserIds.push(id);
  await db.insert(schema.users).values({
    id,
    email: input.email ?? `${id}@echfronthk.com`,
    displayName: input.role === "admin" ? "Route Test Admin" : "Route Test Staff",
    passwordHash: await hashPassword("CorrectPass123"),
    role: input.role,
    isActive: input.isActive ?? 1,
    failedLoginAttempts: input.failedLoginAttempts ?? 0,
    lockedUntil: input.lockedUntil ?? null,
    mustChangePassword: 0,
    passwordChangedAt: null,
    passwordResetAt: null,
    initialDeviceAutoApprovalEligible: 0,
    deletedAt: input.deletedAt ?? null,
    cloudflareAccessEmail: input.accessEmail ?? null,
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

async function login(
  accessEmail: string,
  crmEmail: string,
  password = "CorrectPass123",
  options?: { accessEmailBody?: string; accessEmailQuery?: string },
) {
  requestNumber += 1;
  const token = await signAccessJwt(accessEmail);
  const query = options?.accessEmailQuery
    ? `?access_email=${encodeURIComponent(options.accessEmailQuery)}`
    : "";
  return handlePostLogin(
    new Request(`https://crm.example.com/api/auth/login${query}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cf-Access-Jwt-Assertion": token,
        "cf-connecting-ip": `198.51.${requestIpPrefix}.${requestNumber}`,
        "user-agent": "login-route-integration",
      },
      body: JSON.stringify({
        email: crmEmail,
        password,
        ...(options?.accessEmailBody
          ? { access_email: options.accessEmailBody }
          : {}),
      }),
    }),
    cookieStore(),
  );
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function countSessions(userId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      eq(schema.sessions.userId, userId),
    );
  return rows.length;
}

async function countActiveSessions(userId: string): Promise<number> {
  const rows = await db
    .select({ revokedAt: schema.sessions.revokedAt })
    .from(schema.sessions)
    .where(
      eq(schema.sessions.userId, userId),
    );
  return rows.filter((row) => row.revokedAt === null).length;
}

describe("POST /api/auth/login Staff Access Email binding", () => {
  before(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    publicJwk.kid = "login-route-test";

    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../../../wrangler.jsonc", import.meta.url).pathname,
    });
    db = drizzle(proxy.env.DB, { schema });
    dispose = proxy.dispose;
    bindTestDatabase(db);
    await db
      .delete(schema.systemSettings)
      .where(eq(schema.systemSettings.key, "staff_access_reverify_after"));
    setAccessJwtTestDeps({
      teamDomain: TEAM_DOMAIN,
      audience: AUDIENCE,
      getKey: createLocalJWKSet({ keys: [publicJwk] }),
    });
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production";
    env.CF_ACCESS_TEAM_DOMAIN = TEAM_DOMAIN;
    env.CF_ACCESS_AUD = AUDIENCE;
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await db
        .delete(schema.sessions)
        .where(inArray(schema.sessions.userId, createdUserIds));
      await db
        .delete(schema.authorizedDevices)
        .where(inArray(schema.authorizedDevices.userId, createdUserIds));
      await db
        .delete(schema.users)
        .where(inArray(schema.users.id, createdUserIds.splice(0)));
    }
    setAccessJwtTestDeps(null);
    resetAccessJwtJwksCache();
    bindTestDatabase(null);
    await dispose?.();
    dispose = undefined;
  });

  it("first-binds a personal Access Email to a company CRM Staff account", async () => {
    const user = await createUser({
      role: "staff",
      email: "daniel@echfronthk.com",
    });
    const response = await login(
      "daniel@gmail.com",
      user.email,
      "CorrectPass123",
      {
        accessEmailBody: "spoofed@example.com",
        accessEmailQuery: "spoofed@example.com",
      },
    );
    const body = await responseJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(Object.keys(body.user as object).sort(), [
      "displayName",
      "email",
      "id",
      "role",
    ]);
    assert.equal(await countSessions(user.id), 1);
    const [updated] = await db
      .select({ accessEmail: schema.users.cloudflareAccessEmail })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);
    assert.equal(updated?.accessEmail, "daniel@gmail.com");
  });

  it("allows an existing Staff binding match and leaves it unchanged", async () => {
    const accessEmail = "daniel+match@gmail.com";
    const user = await createUser({
      role: "staff",
      accessEmail: accessEmail,
    });
    const response = await login(` ${accessEmail.toUpperCase()} `, user.email);

    assert.equal(response.status, 200);
    assert.equal((await responseJson(response)).ok, true);
    assert.equal(await countSessions(user.id), 1);
    assert.equal(
      (
        await db
          .select({ accessEmail: schema.users.cloudflareAccessEmail })
          .from(schema.users)
          .where(eq(schema.users.id, user.id))
          .limit(1)
      )[0]?.accessEmail,
      accessEmail,
    );
  });

  it("denies Staff binding mismatch without creating a Session", async () => {
    const accessEmail = "daniel+mismatch@gmail.com";
    const user = await createUser({
      role: "staff",
      accessEmail,
      failedLoginAttempts: 2,
    });
    const before = await countSessions(user.id);
    const response = await login("other+mismatch@gmail.com", user.email);
    const body = await responseJson(response);

    assert.equal(response.status, 401);
    assert.equal(body.errorCode, "UNAUTHORIZED_EMAIL");
    assert.match(String(body.error), /Access.*CRM.*不匹配/);
    assert.equal(await countSessions(user.id), before);
    const [unchanged] = await db
      .select({
        accessEmail: schema.users.cloudflareAccessEmail,
        failedLoginAttempts: schema.users.failedLoginAttempts,
      })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);
    assert.equal(unchanged?.accessEmail, accessEmail);
    assert.equal(unchanged?.failedLoginAttempts, 2);
  });

  it("denies a wrong CRM password without binding or creating a Session", async () => {
    const user = await createUser({ role: "staff" });
    const response = await login("daniel@gmail.com", user.email, "WrongPass123");

    assert.equal(response.status, 401);
    assert.equal(await countSessions(user.id), 0);
    assert.equal(
      (
        await db
          .select({ accessEmail: schema.users.cloudflareAccessEmail })
          .from(schema.users)
          .where(eq(schema.users.id, user.id))
          .limit(1)
      )[0]?.accessEmail,
      null,
    );
  });

  it("retains only one active Session when Staff logs in again", async () => {
    const user = await createUser({
      role: "staff",
      accessEmail: "session-revoke@gmail.com",
    });
    assert.equal(
      (await login("session-revoke@gmail.com", user.email)).status,
      200,
    );
    assert.equal(await countActiveSessions(user.id), 1);
    assert.equal(
      (await login("session-revoke@gmail.com", user.email)).status,
      200,
    );
    assert.equal(await countSessions(user.id), 2);
    assert.equal(await countActiveSessions(user.id), 1);
  });

  it("keeps legacy same-email mode unbound until personal Access migration", async () => {
    const user = await createUser({
      role: "staff",
      email: "legacy@echfronthk.com",
    });

    const wrongPassword = await login(
      "legacy@echfronthk.com",
      user.email,
      "WrongPass123",
    );
    assert.equal(wrongPassword.status, 401);
    assert.equal(await countSessions(user.id), 0);

    const legacyLogin = await login("legacy@echfronthk.com", user.email);
    assert.equal(legacyLogin.status, 200);
    assert.equal((await responseJson(legacyLogin)).ok, true);
    assert.equal(await countSessions(user.id), 1);
    assert.equal(
      (
        await db
          .select({ accessEmail: schema.users.cloudflareAccessEmail })
          .from(schema.users)
          .where(eq(schema.users.id, user.id))
          .limit(1)
      )[0]?.accessEmail,
      null,
    );

    const personalLogin = await login("legacy.personal@gmail.com", user.email);
    assert.equal(personalLogin.status, 200);
    assert.equal(await countActiveSessions(user.id), 1);
    assert.equal(
      (
        await db
          .select({ accessEmail: schema.users.cloudflareAccessEmail })
          .from(schema.users)
          .where(eq(schema.users.id, user.id))
          .limit(1)
      )[0]?.accessEmail,
      "legacy.personal@gmail.com",
    );

    const legacyAfterBinding = await login("legacy@echfronthk.com", user.email);
    assert.equal(legacyAfterBinding.status, 401);
    assert.equal(await countActiveSessions(user.id), 1);
    assert.equal(
      (
        await db
          .select({ accessEmail: schema.users.cloudflareAccessEmail })
          .from(schema.users)
          .where(eq(schema.users.id, user.id))
          .limit(1)
      )[0]?.accessEmail,
      "legacy.personal@gmail.com",
    );
  });

  it("denies a duplicate Access identity for an unbound Staff account", async () => {
    const accessEmail = "personal+duplicate@gmail.com";
    const first = await createUser({
      role: "staff",
      accessEmail,
    });
    const second = await createUser({ role: "staff" });
    const response = await login(accessEmail, second.email);

    assert.equal(response.status, 401);
    assert.equal(await countSessions(second.id), 0);
    assert.equal(
      (
        await db
          .select({ accessEmail: schema.users.cloudflareAccessEmail })
          .from(schema.users)
          .where(eq(schema.users.id, first.id))
          .limit(1)
      )[0]?.accessEmail,
      accessEmail,
    );
    assert.equal(
      (
        await db
          .select({ accessEmail: schema.users.cloudflareAccessEmail })
          .from(schema.users)
          .where(eq(schema.users.id, second.id))
          .limit(1)
      )[0]?.accessEmail,
      null,
    );
  });

  it("does not let Staff A use legacy company identity for Staff B", async () => {
    const staffA = await createUser({
      role: "staff",
      email: "staffa@echfronthk.com",
    });
    const staffB = await createUser({
      role: "staff",
      email: "staffb@echfronthk.com",
    });
    const response = await login(staffA.email, staffB.email);

    assert.equal(response.status, 401);
    assert.equal(await countSessions(staffB.id), 0);
    assert.equal(
      (
        await db
          .select({ accessEmail: schema.users.cloudflareAccessEmail })
          .from(schema.users)
          .where(eq(schema.users.id, staffB.id))
          .limit(1)
      )[0]?.accessEmail,
      null,
    );
  });

  it("keeps Admin Access restrictions and does not create Staff binding", async () => {
    const admin = await createUser({ role: "admin" });
    const normal = await login(admin.email, admin.email);
    assert.equal(normal.status, 200);

    const denied = await login("staff-personal@gmail.com", admin.email);
    assert.equal(denied.status, 401);
    assert.equal(
      (
        await db
          .select({ accessEmail: schema.users.cloudflareAccessEmail })
          .from(schema.users)
          .where(eq(schema.users.id, admin.id))
          .limit(1)
      )[0]?.accessEmail,
      null,
    );

    const previousSuperAdminEmail = process.env.CF_ACCESS_SUPER_ADMIN_EMAIL;
    process.env.CF_ACCESS_SUPER_ADMIN_EMAIL = "super-admin@gmail.com";
    try {
      const crossAccount = await login("super-admin@gmail.com", admin.email);
      assert.equal(crossAccount.status, 200);
    } finally {
      if (previousSuperAdminEmail === undefined) {
        delete process.env.CF_ACCESS_SUPER_ADMIN_EMAIL;
      } else {
        process.env.CF_ACCESS_SUPER_ADMIN_EMAIL = previousSuperAdminEmail;
      }
    }
  });

  it("does not bind inactive, deleted, or locked Staff", async () => {
    for (const input of [
      { isActive: 0 },
      { deletedAt: new Date().toISOString() },
      { lockedUntil: new Date().toISOString() },
    ]) {
      const user = await createUser({ role: "staff", ...input });
      const response = await login("blocked@gmail.com", user.email);
      assert.notEqual(response.status, 200);
      assert.equal(await countSessions(user.id), 0);
      assert.equal(
        (
          await db
            .select({ accessEmail: schema.users.cloudflareAccessEmail })
            .from(schema.users)
            .where(eq(schema.users.id, user.id))
            .limit(1)
        )[0]?.accessEmail,
        null,
      );
    }
  });

  it("preserves Staff three-failure lockout through the real login route", async () => {
    const user = await createUser({ role: "staff" });
    const attempts: Response[] = [];
    for (let i = 0; i < 3; i += 1) {
      attempts.push(await login("lockout@gmail.com", user.email, "WrongPass123"));
    }
    assert.deepEqual(attempts.map((response) => response.status).sort(), [
      401,
      401,
      423,
    ]);
    const [locked] = await db
      .select({
        failedLoginAttempts: schema.users.failedLoginAttempts,
        lockedUntil: schema.users.lockedUntil,
        accessEmail: schema.users.cloudflareAccessEmail,
      })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);
    assert.equal(locked?.failedLoginAttempts, 3);
    assert.ok(locked?.lockedUntil);
    assert.equal(locked?.accessEmail, null);
    assert.equal(await countSessions(user.id), 0);
  });
});
