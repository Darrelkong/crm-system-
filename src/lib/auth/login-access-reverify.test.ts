import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
} from "jose";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import {
  resetAccessJwtJwksCache,
  setAccessJwtTestDeps,
  verifyCloudflareAccessJwt,
} from "@/lib/auth/access-jwt";
import {
  STAFF_ACCESS_REVERIFY_AFTER_KEY,
  evaluateStaffLoginAccessEpochGate,
  getGlobalIdlePolicy,
} from "@/lib/settings/global-idle-exemption";

const TEAM_DOMAIN = "https://example-team.cloudflareaccess.com";
const AUDIENCE = "test-aud-login-reverify";
const STAFF_EMAIL = "staff-a@crm.local";
const ADMIN_EMAIL = "admin@crm.local";

let privateKey: CryptoKey;
let publicJwk: JWK;
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

async function signAccessJwt(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .sign(privateKey);
}

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const env = process.env as Record<string, string | undefined>;
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) {
        delete env[key];
      } else {
        env[key] = previous[key];
      }
    }
  });
}

async function upsertEpoch(value: string) {
  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, STAFF_ACCESS_REVERIFY_AFTER_KEY))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(schema.systemSettings)
      .set({ value, updatedAt: now })
      .where(eq(schema.systemSettings.key, STAFF_ACCESS_REVERIFY_AFTER_KEY));
  } else {
    await db.insert(schema.systemSettings).values({
      key: STAFF_ACCESS_REVERIFY_AFTER_KEY,
      value,
      updatedAt: now,
    });
  }
}

describe("login Access JWT iat reverify gate", () => {
  before(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    publicJwk.kid = "login-reverify-kid";

    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
  });

  afterEach(() => {
    setAccessJwtTestDeps(null);
    resetAccessJwtJwksCache();
  });

  after(async () => {
    await db
      .delete(schema.systemSettings)
      .where(eq(schema.systemSettings.key, STAFF_ACCESS_REVERIFY_AFTER_KEY));
    bindTestDatabase(null);
    if (disposeProxy) {
      await disposeProxy();
    }
  });

  it("login route checks Access epoch before device login and createSession", () => {
    const routePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../app/api/auth/login/route.ts",
    );
    const source = readFileSync(routePath, "utf8");
    const gateIdx = source.indexOf("evaluateStaffLoginAccessEpochGate({");
    const deviceIdx = source.indexOf("await evaluateStaffDeviceLogin(");
    const sessionIdx = source.indexOf("await createSession(");
    assert.ok(gateIdx > 0, "gate must be present");
    assert.ok(deviceIdx > gateIdx, "device login must run after Access epoch gate");
    assert.ok(sessionIdx > gateIdx, "createSession must run after Access epoch gate");
  });

  it("verified Access JWT iat after epoch allows staff gate", async () => {
    const epoch = Math.floor(Date.now() / 1000) - 60;
    await upsertEpoch(String(epoch));
    const policy = await getGlobalIdlePolicy(db);
    assert.equal(policy.staffAccessReverifyAfter, epoch);

    await withEnv(
      {
        NODE_ENV: "production",
        CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
        CF_ACCESS_AUD: AUDIENCE,
      },
      async () => {
        setAccessJwtTestDeps({
          teamDomain: TEAM_DOMAIN,
          audience: AUDIENCE,
          getKey: createLocalJWKSet({ keys: [publicJwk] }),
        });
        const iat = epoch + 10;
        const token = await signAccessJwt({
          email: STAFF_EMAIL,
          iat,
          exp: iat + 600,
          iss: TEAM_DOMAIN,
          aud: AUDIENCE,
        });
        const verified = await verifyCloudflareAccessJwt(token);
        assert.equal(verified.ok, true);
        if (!verified.ok) return;

        const decision = evaluateStaffLoginAccessEpochGate({
          role: "staff",
          accessCheckRequired: true,
          accessIat: verified.identity.iat,
          reverifyAfterUnixSec: policy.staffAccessReverifyAfter,
        });
        assert.equal(decision.allowed, true);
      },
    );
  });

  it("verified Access JWT iat at/before epoch denies staff with dedicated code", async () => {
    const epoch = Math.floor(Date.now() / 1000) - 30;
    await upsertEpoch(String(epoch));
    const policy = await getGlobalIdlePolicy(db);

    await withEnv(
      {
        NODE_ENV: "production",
        CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
        CF_ACCESS_AUD: AUDIENCE,
      },
      async () => {
        setAccessJwtTestDeps({
          teamDomain: TEAM_DOMAIN,
          audience: AUDIENCE,
          getKey: createLocalJWKSet({ keys: [publicJwk] }),
        });

        for (const iat of [epoch, epoch - 5]) {
          const token = await signAccessJwt({
            email: STAFF_EMAIL,
            iat,
            exp: iat + 600,
            iss: TEAM_DOMAIN,
            aud: AUDIENCE,
          });
          const verified = await verifyCloudflareAccessJwt(token);
          assert.equal(verified.ok, true);
          if (!verified.ok) return;

          const decision = evaluateStaffLoginAccessEpochGate({
            role: "staff",
            accessCheckRequired: true,
            accessIat: verified.identity.iat,
            reverifyAfterUnixSec: policy.staffAccessReverifyAfter,
          });
          assert.equal(decision.allowed, false);
          if (!decision.allowed) {
            assert.equal(
              decision.errorCode,
              AUTH_ERROR_CODES.SESSION_ACCESS_REVERIFY_REQUIRED,
            );
          }
        }
      },
    );
  });

  it("admin is not blocked by old Access JWT iat", async () => {
    const epoch = Math.floor(Date.now() / 1000);
    await upsertEpoch(String(epoch));
    const policy = await getGlobalIdlePolicy(db);

    const decision = evaluateStaffLoginAccessEpochGate({
      role: "admin",
      accessCheckRequired: true,
      accessIat: epoch - 100,
      reverifyAfterUnixSec: policy.staffAccessReverifyAfter,
    });
    assert.equal(decision.allowed, true);
    void ADMIN_EMAIL;
  });

  it("epoch 0 keeps existing staff login path open", async () => {
    await upsertEpoch("0");
    const policy = await getGlobalIdlePolicy(db);
    assert.equal(policy.staffAccessReverifyAfter, 0);

    const decision = evaluateStaffLoginAccessEpochGate({
      role: "staff",
      accessCheckRequired: true,
      accessIat: null,
      reverifyAfterUnixSec: policy.staffAccessReverifyAfter,
    });
    assert.equal(decision.allowed, true);
  });

  it("development/test Access skip does not block staff when epoch is active", async () => {
    await upsertEpoch(String(Math.floor(Date.now() / 1000)));
    const policy = await getGlobalIdlePolicy(db);

    // Mirrors login route: accessCheckSkipped=true → accessCheckRequired=false
    const decision = evaluateStaffLoginAccessEpochGate({
      role: "staff",
      accessCheckRequired: false,
      accessIat: null,
      reverifyAfterUnixSec: policy.staffAccessReverifyAfter,
    });
    assert.equal(decision.allowed, true);
  });

  it("denied gate does not require session or device writes (pure decision)", async () => {
    const beforeSessions = await db.select().from(schema.sessions);
    const beforeDevices = await db.select().from(schema.authorizedDevices);

    const decision = evaluateStaffLoginAccessEpochGate({
      role: "staff",
      accessCheckRequired: true,
      accessIat: 1,
      reverifyAfterUnixSec: 9999999999,
    });
    assert.equal(decision.allowed, false);

    const afterSessions = await db.select().from(schema.sessions);
    const afterDevices = await db.select().from(schema.authorizedDevices);
    assert.equal(afterSessions.length, beforeSessions.length);
    assert.equal(afterDevices.length, beforeDevices.length);
  });
});
