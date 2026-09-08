import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
} from "jose";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  createSession,
  destroySession,
  validateSessionToken,
} from "@/lib/auth/session";
import {
  resetAccessJwtJwksCache,
  setAccessJwtTestDeps,
  verifyCloudflareAccessJwt,
} from "@/lib/auth/access-jwt";
import { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";

const TEAM_DOMAIN = "https://auth-separation-test.cloudflareaccess.com";
const AUDIENCE = "auth-separation-test";
const ACCESS_EMAIL = "staff-a@isolated.test";
const DEVICE_ID_HASH = "auth-separation-device-hash";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let privateKey: CryptoKey;
let publicJwk: JWK;

function withProductionEnv<T>(fn: () => Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const previous = {
    NODE_ENV: env.NODE_ENV,
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    audience: env.CF_ACCESS_AUD,
  };
  env.NODE_ENV = "production";
  env.CF_ACCESS_TEAM_DOMAIN = TEAM_DOMAIN;
  env.CF_ACCESS_AUD = AUDIENCE;
  return fn().finally(() => {
    if (previous.NODE_ENV === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous.NODE_ENV;
    if (previous.teamDomain === undefined) delete env.CF_ACCESS_TEAM_DOMAIN;
    else env.CF_ACCESS_TEAM_DOMAIN = previous.teamDomain;
    if (previous.audience === undefined) delete env.CF_ACCESS_AUD;
    else env.CF_ACCESS_AUD = previous.audience;
  });
}

async function signAccessJwt(input: {
  email?: string;
  exp?: number;
  iat?: number;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const iat = input.iat ?? now;
  return new SignJWT({
    email: input.email ?? ACCESS_EMAIL,
    iat,
    exp: input.exp ?? now + 3600,
    iss: TEAM_DOMAIN,
    aud: AUDIENCE,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "auth-separation-test" })
    .sign(privateKey);
}

async function cleanupSessions() {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, SEED_IDS.staffA));
}

describe("Access and CRM session separation — real Wrangler D1", () => {
  before(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    publicJwk.kid = "auth-separation-test";

    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    setAccessJwtTestDeps({
      teamDomain: TEAM_DOMAIN,
      audience: AUDIENCE,
      getKey: createLocalJWKSet({ keys: [publicJwk] }),
    });
    await cleanupSessions();
  });

  after(async () => {
    await cleanupSessions();
    setAccessJwtTestDeps(null);
    resetAccessJwtJwksCache();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("revokes only the CRM session when idle expires and keeps Access valid", async () => {
    await withProductionEnv(async () => {
      const { token, sessionId } = await createSession(
        SEED_IDS.staffA,
        new Request("https://crm.example.com/staff"),
        DEVICE_ID_HASH,
      );
      await db
        .update(schema.sessions)
        .set({
          lastActivityAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
        })
        .where(eq(schema.sessions.id, sessionId));

      const crmResult = await validateSessionToken(token, { touch: false });
      assert.equal(crmResult.ok, false);
      if (!crmResult.ok) {
        assert.equal(crmResult.reason, "idle_expired");
        assert.equal(crmResult.errorCode, "SESSION_IDLE_EXPIRED");
      }

      const repeatedCrmResult = await validateSessionToken(token, {
        touch: false,
      });
      assert.equal(repeatedCrmResult.ok, false);
      if (!repeatedCrmResult.ok) {
        assert.equal(repeatedCrmResult.reason, "revoked");
      }

      const accessResult = await verifyCloudflareAccessJwt(
        await signAccessJwt(),
      );
      assert.equal(accessResult.ok, true);
    });
  });

  it("treats a missing CRM session independently from a valid Access identity", async () => {
    await withProductionEnv(async () => {
      const crmResult = await validateSessionToken(
        "missing-crm-session-token",
        { touch: false },
      );
      const accessResult = await verifyCloudflareAccessJwt(
        await signAccessJwt(),
      );

      assert.equal(crmResult.ok, false);
      if (!crmResult.ok) assert.equal(crmResult.reason, "invalid");
      assert.equal(accessResult.ok, true);
    });
  });

  it("routes an actually expired Access JWT to Access revalidation", async () => {
    await withProductionEnv(async () => {
      const now = Math.floor(Date.now() / 1000);
      const result = await verifyCloudflareAccessJwt(
        await signAccessJwt({ iat: now - 180, exp: now - 60 }),
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "expired");
    });
  });

  it("revokes CRM session for manual logout without contacting Access", async () => {
    await withProductionEnv(async () => {
      const { token } = await createSession(
        SEED_IDS.staffA,
        new Request("https://crm.example.com/staff"),
        DEVICE_ID_HASH,
      );

      await destroySession(token);

      const result = await validateSessionToken(token, { touch: false });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "revoked");
      assert.equal(getPostLogoutRedirectPath(), "/cdn-cgi/access/logout");
    });
  });
});
