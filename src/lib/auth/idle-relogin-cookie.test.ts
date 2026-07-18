import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
} from "jose";
import {
  setAccessJwtTestDeps,
  resetAccessJwtJwksCache,
  validateAccessLoginWindowFromRequest,
} from "@/lib/auth/access-jwt";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import {
  IDLE_RELOGIN_COUNT_COOKIE,
  ACCESS_IAT_MARKER_COOKIE,
  IDLE_RELOGIN_THRESHOLD,
  computeIdleReloginState,
  computeIncrementedIdleRelogin,
  getAccessIatFromHeaders,
  getIdleReloginCookieOptions,
  parseIdleReloginCount,
  resolveIdleReloginStateFromRequest,
} from "@/lib/auth/idle-relogin-cookie";
import { isTimeoutLoginReason } from "@/lib/auth/timeout-login-visits";

const TEAM_DOMAIN = "https://example-team.cloudflareaccess.com";
const AUDIENCE = "test-aud-value";

let privateKey: CryptoKey;
let publicJwk: JWK;

async function signAccessJwt(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .sign(privateKey);
}

function unsignedFakeJwt(iat: number): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    iat,
    exp: iat + 3600,
    email: "anyone@example.com",
  })}.sig`;
}

async function withProductionAccess<T>(fn: () => T | Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const prevEnv = env.NODE_ENV;
  const prevSkip = env.SKIP_ACCESS_JWT_CHECK;
  const prevTeam = env.CF_ACCESS_TEAM_DOMAIN;
  const prevAud = env.CF_ACCESS_AUD;
  env.NODE_ENV = "production";
  delete env.SKIP_ACCESS_JWT_CHECK;
  env.CF_ACCESS_TEAM_DOMAIN = TEAM_DOMAIN;
  env.CF_ACCESS_AUD = AUDIENCE;
  try {
    return await fn();
  } finally {
    env.NODE_ENV = prevEnv;
    if (prevSkip !== undefined) {
      env.SKIP_ACCESS_JWT_CHECK = prevSkip;
    } else {
      delete env.SKIP_ACCESS_JWT_CHECK;
    }
    if (prevTeam !== undefined) {
      env.CF_ACCESS_TEAM_DOMAIN = prevTeam;
    } else {
      delete env.CF_ACCESS_TEAM_DOMAIN;
    }
    if (prevAud !== undefined) {
      env.CF_ACCESS_AUD = prevAud;
    } else {
      delete env.CF_ACCESS_AUD;
    }
  }
}

async function makeAccessRequest(options: {
  count: number;
  marker: number;
  accessIat: number;
  unsigned?: boolean;
}): Promise<Request> {
  const cookie = `${IDLE_RELOGIN_COUNT_COOKIE}=${options.count}; ${ACCESS_IAT_MARKER_COOKIE}=${options.marker}`;
  const token = options.unsigned
    ? unsignedFakeJwt(options.accessIat)
    : await signAccessJwt({
        email: "staff.a@example.com",
        iat: options.accessIat,
        exp: options.accessIat + 3600,
        iss: TEAM_DOMAIN,
        aud: AUDIENCE,
      });
  return new Request("https://crm.echfronthk.com/api/auth/login", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Host: "crm.echfronthk.com",
      "Cf-Access-Jwt-Assertion": token,
      "Content-Type": "application/json",
    },
  });
}

/** Mirrors login/route.ts idle gate before credential validation. */
async function simulateLoginApiIdleGate(request: Request): Promise<{
  blocked: boolean;
  errorCode?: string;
}> {
  const accessWindow = await validateAccessLoginWindowFromRequest(request);
  if (!accessWindow.ok) {
    return {
      blocked: true,
      errorCode: AUTH_ERROR_CODES.ACCESS_VERIFICATION_EXPIRED,
    };
  }

  const idleState = await resolveIdleReloginStateFromRequest(request);
  if (idleState.requiresAccessReverify) {
    return {
      blocked: true,
      errorCode: AUTH_ERROR_CODES.ACCESS_VERIFICATION_EXPIRED,
    };
  }

  return { blocked: false };
}

/** Mirrors login/page.tsx SSR view selection (read-only; no cookie writes). */
async function simulateLoginPageView(
  request: Request,
): Promise<"LoginForm" | "AccessExpiredGate"> {
  const accessWindow = await validateAccessLoginWindowFromRequest(request);
  if (!accessWindow.ok) {
    return "AccessExpiredGate";
  }

  const idleState = await resolveIdleReloginStateFromRequest(request);
  if (idleState.requiresAccessReverify) {
    return "AccessExpiredGate";
  }

  return "LoginForm";
}

before(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  publicJwk.kid = "test-kid";
});

after(() => {
  setAccessJwtTestDeps(null);
  resetAccessJwtJwksCache();
});

function installLocalJwks() {
  setAccessJwtTestDeps({
    teamDomain: TEAM_DOMAIN,
    audience: AUDIENCE,
    getKey: createLocalJWKSet({ keys: [publicJwk] }),
  });
}

describe("idle relogin cookie", () => {
  it("uses a threshold of 3 idle logouts before Access reverify", () => {
    assert.equal(IDLE_RELOGIN_THRESHOLD, 3);
  });

  it("starts from count 0 when no cookie is present", () => {
    assert.equal(parseIdleReloginCount(undefined), 0);
  });

  it("allows CRM login for counts 1 and 2 within the same Access cycle", () => {
    assert.equal(
      computeIdleReloginState(1000, 1, 1000).requiresAccessReverify,
      false,
    );
    assert.equal(
      computeIdleReloginState(1000, 2, 1000).requiresAccessReverify,
      false,
    );
  });

  it("requires Access reverify when count reaches 3 with the same Access iat", () => {
    assert.equal(
      computeIdleReloginState(1000, 3, 1000).requiresAccessReverify,
      true,
    );
  });

  it("resets count when Access iat advances after reverify", () => {
    const state = computeIdleReloginState(2000, 3, 1000);
    assert.equal(state.count, 0);
    assert.equal(state.requiresAccessReverify, false);
    assert.deepEqual(state.cookieUpdate, {
      count: 0,
      accessIatMarker: 2000,
    });
  });

  it("does not reset count on CRM login alone within the same Access cycle", () => {
    const state = computeIdleReloginState(1000, 2, 1000);
    assert.equal(state.count, 2);
    assert.equal(state.requiresAccessReverify, false);
    assert.equal(state.cookieUpdate, null);
  });

  it("increments idle logout count through 1, 2, and 3", () => {
    assert.deepEqual(computeIncrementedIdleRelogin(0, 1000, null), {
      count: 1,
      accessIatMarker: 1000,
    });
    assert.deepEqual(computeIncrementedIdleRelogin(1, 1000, 1000), {
      count: 2,
      accessIatMarker: 1000,
    });
    assert.deepEqual(computeIncrementedIdleRelogin(2, 1000, 1000), {
      count: 3,
      accessIatMarker: 1000,
    });
  });

  it("parses stored idle relogin counts", () => {
    assert.equal(parseIdleReloginCount(undefined), 0);
    assert.equal(parseIdleReloginCount("2"), 2);
    assert.equal(parseIdleReloginCount("0"), 0);
    assert.equal(parseIdleReloginCount("invalid"), 0);
  });

  it("sets secure httpOnly lax cookies for idle relogin state", async () => {
    await withProductionAccess(() => {
      const options = getIdleReloginCookieOptions();
      assert.equal(options.httpOnly, true);
      assert.equal(options.secure, true);
      assert.equal(options.sameSite, "lax");
      assert.equal(options.path, "/");
    });

    const devOptions = getIdleReloginCookieOptions();
    assert.equal(devOptions.httpOnly, true);
    assert.equal(devOptions.secure, process.env.NODE_ENV === "production");
    assert.equal(devOptions.sameSite, "lax");
    assert.equal(devOptions.path, "/");
  });
});

describe("idle relogin production request simulation", () => {
  it("does not block login API when count is 1 or 2", async () => {
    await withProductionAccess(async () => {
      installLocalJwks();
      const iat = Math.floor(Date.now() / 1000);

      assert.deepEqual(
        await simulateLoginApiIdleGate(
          await makeAccessRequest({ count: 1, marker: iat, accessIat: iat }),
        ),
        { blocked: false },
      );
      assert.deepEqual(
        await simulateLoginApiIdleGate(
          await makeAccessRequest({ count: 2, marker: iat, accessIat: iat }),
        ),
        { blocked: false },
      );
    });
  });

  it("blocks login API when count is 3 and Access iat is unchanged", async () => {
    await withProductionAccess(async () => {
      installLocalJwks();
      const iat = Math.floor(Date.now() / 1000);
      const result = await simulateLoginApiIdleGate(
        await makeAccessRequest({ count: 3, marker: iat, accessIat: iat }),
      );

      assert.equal(result.blocked, true);
      assert.equal(result.errorCode, AUTH_ERROR_CODES.ACCESS_VERIFICATION_EXPIRED);
    });
  });

  it("allows login API after Access iat advances and resets count", async () => {
    await withProductionAccess(async () => {
      installLocalJwks();
      const iat = Math.floor(Date.now() / 1000);
      const previousIat = iat - 120;
      const state = await resolveIdleReloginStateFromRequest(
        await makeAccessRequest({
          count: 3,
          marker: previousIat,
          accessIat: iat,
        }),
      );

      assert.equal(state.count, 0);
      assert.equal(state.requiresAccessReverify, false);

      const result = await simulateLoginApiIdleGate(
        await makeAccessRequest({
          count: 3,
          marker: previousIat,
          accessIat: iat,
        }),
      );
      assert.deepEqual(result, { blocked: false });
    });
  });

  it("shows LoginForm for count 1 and 2 on login page SSR", async () => {
    await withProductionAccess(async () => {
      installLocalJwks();
      const iat = Math.floor(Date.now() / 1000);

      assert.equal(
        await simulateLoginPageView(
          await makeAccessRequest({ count: 1, marker: iat, accessIat: iat }),
        ),
        "LoginForm",
      );
      assert.equal(
        await simulateLoginPageView(
          await makeAccessRequest({ count: 2, marker: iat, accessIat: iat }),
        ),
        "LoginForm",
      );
    });
  });

  it("shows AccessExpiredGate for count 3 when Access iat is unchanged", async () => {
    await withProductionAccess(async () => {
      installLocalJwks();
      const iat = Math.floor(Date.now() / 1000);
      assert.equal(
        await simulateLoginPageView(
          await makeAccessRequest({ count: 3, marker: iat, accessIat: iat }),
        ),
        "AccessExpiredGate",
      );
    });
  });

  it("returns LoginForm after Access iat advances on login page SSR", async () => {
    await withProductionAccess(async () => {
      installLocalJwks();
      const iat = Math.floor(Date.now() / 1000);
      assert.equal(
        await simulateLoginPageView(
          await makeAccessRequest({
            count: 3,
            marker: iat - 120,
            accessIat: iat,
          }),
        ),
        "LoginForm",
      );
    });
  });

  it("rejects unsigned fake JWT for access iat marker", async () => {
    await withProductionAccess(async () => {
      installLocalJwks();
      const iat = Math.floor(Date.now() / 1000);
      const request = await makeAccessRequest({
        count: 1,
        marker: iat,
        accessIat: iat,
        unsigned: true,
      });
      const accessIat = await getAccessIatFromHeaders(request.headers);
      assert.equal(accessIat, null);

      const gate = await simulateLoginApiIdleGate(request);
      assert.equal(gate.blocked, true);
    });
  });
});

describe("timeout login reasons", () => {
  it("detects timeout login reasons for UI notices", () => {
    assert.equal(isTimeoutLoginReason("timeout", null), true);
    assert.equal(isTimeoutLoginReason(null, "idle"), true);
    assert.equal(isTimeoutLoginReason(null, "revoked"), false);
  });
});

describe("login page cookie safety", () => {
  it("does not write cookies in login/page.tsx", () => {
    const source = readFileSync(
      new URL("../../app/(auth)/login/page.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /cookies\(\)\.set\s*\(/);
    assert.doesNotMatch(source, /cookies\(\)\.delete\s*\(/);
    assert.doesNotMatch(source, /applyIdleReloginCookieUpdateToStore/);
  });
});
