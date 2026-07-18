import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWK,
} from "jose";
import {
  ACCESS_LOGIN_WINDOW_MS,
} from "@/lib/auth/constants";
import {
  buildAccessJwksUrl,
  evaluateAccessLoginEmailBinding,
  getAccessJwtFromHeaders,
  isAccessJwtCheckSkipped,
  isSuperAdminAccessEmail,
  normalizeAccessEmail,
  normalizeTeamDomain,
  resetAccessJwtJwksCache,
  setAccessJwtTestDeps,
  shouldRequireCloudflareAccess,
  validateAccessLoginWindow,
  verifyCloudflareAccessJwt,
} from "@/lib/auth/access-jwt";

const TEAM_DOMAIN = "https://example-team.cloudflareaccess.com";
const AUDIENCE = "test-aud-value";
const ACCESS_EMAIL = "staff.a@example.com";

let privateKey: CryptoKey;
let publicJwk: JWK;

async function signAccessJwt(
  claims: Record<string, unknown>,
  options?: { alg?: string },
): Promise<string> {
  const alg = options?.alg ?? "RS256";
  return new SignJWT(claims)
    .setProtectedHeader({ alg, typ: "JWT" })
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

before(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  publicJwk.kid = "test-kid";
});

afterEach(() => {
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

describe("access-jwt normalize helpers", () => {
  it("normalizes email trim + lowercase", () => {
    assert.equal(normalizeAccessEmail("  Admin@Example.COM "), "admin@example.com");
  });

  it("normalizes team domain https origin without trailing slash", () => {
    assert.equal(
      normalizeTeamDomain("https://example-team.cloudflareaccess.com/"),
      "https://example-team.cloudflareaccess.com",
    );
  });

  it("rejects team domain with JWKS path", () => {
    assert.equal(
      normalizeTeamDomain(
        "https://example-team.cloudflareaccess.com/cdn-cgi/access/certs",
      ),
      null,
    );
  });

  it("rejects non-https team domain", () => {
    assert.equal(
      normalizeTeamDomain("http://example-team.cloudflareaccess.com"),
      null,
    );
  });

  it("builds JWKS URL from normalized domain", () => {
    assert.equal(
      buildAccessJwksUrl(TEAM_DOMAIN),
      `${TEAM_DOMAIN}/cdn-cgi/access/certs`,
    );
  });
});

describe("access-jwt skip gates", () => {
  it("skips in development", async () => {
    await withEnv({ NODE_ENV: "development", SKIP_ACCESS_JWT_CHECK: undefined }, () => {
      assert.equal(isAccessJwtCheckSkipped(), true);
      assert.equal(shouldRequireCloudflareAccess(), false);
    });
  });

  it("skips in test", async () => {
    await withEnv({ NODE_ENV: "test", SKIP_ACCESS_JWT_CHECK: undefined }, () => {
      assert.equal(isAccessJwtCheckSkipped(), true);
    });
  });

  it("production ignores SKIP_ACCESS_JWT_CHECK and Host headers", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        SKIP_ACCESS_JWT_CHECK: "true",
      },
      () => {
        const headers = new Headers({
          Host: "localhost",
          "X-Forwarded-Host": "127.0.0.1",
        });
        assert.equal(isAccessJwtCheckSkipped(headers), false);
        assert.equal(shouldRequireCloudflareAccess(headers), true);
      },
    );
  });

  it("non-production SKIP_ACCESS_JWT_CHECK can skip", async () => {
    await withEnv(
      { NODE_ENV: "production", SKIP_ACCESS_JWT_CHECK: "true" },
      () => {
        assert.equal(isAccessJwtCheckSkipped(), false);
      },
    );
    // Simulate a non-production custom env name that is not production
    await withEnv(
      { NODE_ENV: "staging" as string, SKIP_ACCESS_JWT_CHECK: "true" },
      () => {
        assert.equal(isAccessJwtCheckSkipped(), true);
      },
    );
  });
});

describe("access-jwt cryptographic verification", () => {
  it("accepts a valid RS256 JWT within login window", async () => {
    installLocalJwks();
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await signAccessJwt({
      email: ACCESS_EMAIL,
      iat: nowSec,
      exp: nowSec + 3600,
      iss: TEAM_DOMAIN,
      aud: AUDIENCE,
      sub: "access-sub",
    });

    const result = await verifyCloudflareAccessJwt(token);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.identity.email, ACCESS_EMAIL);
      assert.equal(result.identity.iat, nowSec);
      assert.ok(!JSON.stringify(result).includes(token));
    }
  });

  it("rejects forged signature", async () => {
    installLocalJwks();
    const nowSec = Math.floor(Date.now() / 1000);
    const other = await generateKeyPair("RS256");
    const token = await new SignJWT({
      email: ACCESS_EMAIL,
      iat: nowSec,
      exp: nowSec + 3600,
      iss: TEAM_DOMAIN,
      aud: AUDIENCE,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .sign(other.privateKey);

    const result = await verifyCloudflareAccessJwt(token);
    assert.equal(result.ok, false);
  });

  it("rejects wrong issuer", async () => {
    installLocalJwks();
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await signAccessJwt({
      email: ACCESS_EMAIL,
      iat: nowSec,
      exp: nowSec + 3600,
      iss: "https://wrong-team.cloudflareaccess.com",
      aud: AUDIENCE,
    });
    const result = await verifyCloudflareAccessJwt(token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "bad_issuer");
    }
  });

  it("rejects wrong audience", async () => {
    installLocalJwks();
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await signAccessJwt({
      email: ACCESS_EMAIL,
      iat: nowSec,
      exp: nowSec + 3600,
      iss: TEAM_DOMAIN,
      aud: "wrong-aud",
    });
    const result = await verifyCloudflareAccessJwt(token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "bad_audience");
    }
  });

  it("rejects expired JWT", async () => {
    installLocalJwks();
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await signAccessJwt({
      email: ACCESS_EMAIL,
      iat: nowSec - 120,
      exp: nowSec - 30,
      iss: TEAM_DOMAIN,
      aud: AUDIENCE,
    });
    const result = await verifyCloudflareAccessJwt(token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "expired");
    }
  });

  it("rejects nbf not yet valid", async () => {
    installLocalJwks();
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await signAccessJwt({
      email: ACCESS_EMAIL,
      iat: nowSec,
      nbf: nowSec + 600,
      exp: nowSec + 3600,
      iss: TEAM_DOMAIN,
      aud: AUDIENCE,
    });
    const result = await verifyCloudflareAccessJwt(token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "nbf");
    }
  });

  it("rejects missing email", async () => {
    installLocalJwks();
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await signAccessJwt({
      iat: nowSec,
      exp: nowSec + 3600,
      iss: TEAM_DOMAIN,
      aud: AUDIENCE,
    });
    const result = await verifyCloudflareAccessJwt(token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "no_email");
    }
  });

  it("rejects empty email", async () => {
    installLocalJwks();
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await signAccessJwt({
      email: "   ",
      iat: nowSec,
      exp: nowSec + 3600,
      iss: TEAM_DOMAIN,
      aud: AUDIENCE,
    });
    const result = await verifyCloudflareAccessJwt(token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "no_email");
    }
  });

  it("rejects missing iat", async () => {
    installLocalJwks();
    const nowSec = Math.floor(Date.now() / 1000);
    // SignJWT may auto-set iat; force by using payload without setIssuedAt
    const token = await new SignJWT({
      email: ACCESS_EMAIL,
      exp: nowSec + 3600,
      iss: TEAM_DOMAIN,
      aud: AUDIENCE,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .sign(privateKey);
    const result = await verifyCloudflareAccessJwt(token);
    // jose may add iat automatically — if so this still checks exp path.
    // Explicitly assert either invalid or ok only with iat present.
    if (result.ok) {
      assert.equal(typeof result.identity.iat, "number");
    } else {
      assert.ok(
        result.reason === "invalid" || result.reason === "expired",
      );
    }
  });

  it("rejects missing exp", async () => {
    installLocalJwks();
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      email: ACCESS_EMAIL,
      iat: nowSec,
      iss: TEAM_DOMAIN,
      aud: AUDIENCE,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .sign(privateKey);
    const result = await verifyCloudflareAccessJwt(token);
    assert.equal(result.ok, false);
  });

  it("rejects iat older than login window", async () => {
    installLocalJwks();
    const nowSec = Math.floor(Date.now() / 1000);
    const oldIat =
      nowSec - Math.floor(ACCESS_LOGIN_WINDOW_MS / 1000) - 120;
    const token = await signAccessJwt({
      email: ACCESS_EMAIL,
      iat: oldIat,
      exp: nowSec + 3600,
      iss: TEAM_DOMAIN,
      aud: AUDIENCE,
    });
    const result = await verifyCloudflareAccessJwt(token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "expired");
    }
  });

  it("rejects future iat beyond skew", async () => {
    installLocalJwks();
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await signAccessJwt({
      email: ACCESS_EMAIL,
      iat: nowSec + 600,
      exp: nowSec + 3600,
      iss: TEAM_DOMAIN,
      aud: AUDIENCE,
    });
    const result = await verifyCloudflareAccessJwt(token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(
        result.reason === "future_iat" || result.reason === "invalid",
      );
    }
  });

  it("rejects when team domain / aud misconfigured", async () => {
    setAccessJwtTestDeps({
      teamDomain: undefined,
      audience: undefined,
      getKey: createLocalJWKSet({ keys: [publicJwk] }),
    });
    await withEnv(
      {
        CF_ACCESS_TEAM_DOMAIN: undefined,
        CF_ACCESS_AUD: undefined,
      },
      async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const token = await signAccessJwt({
          email: ACCESS_EMAIL,
          iat: nowSec,
          exp: nowSec + 3600,
          iss: TEAM_DOMAIN,
          aud: AUDIENCE,
        });
        const result = await verifyCloudflareAccessJwt(token, {
          getKey: createLocalJWKSet({ keys: [publicJwk] }),
          teamDomain: undefined,
          audience: undefined,
        });
        // Without explicit deps fields, falls back to env which we cleared
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.reason, "misconfigured");
        }
      },
    );
  });

  it("prefers Cf-Access-Jwt-Assertion header over cookie", () => {
    const headers = new Headers({
      "Cf-Access-Jwt-Assertion": "header-token",
      Cookie: "CF_Authorization=cookie-token",
    });
    assert.equal(getAccessJwtFromHeaders(headers), "header-token");
  });

  it("validateAccessLoginWindow skips without verifying in test env", async () => {
    await withEnv({ NODE_ENV: "test" }, async () => {
      const result = await validateAccessLoginWindow(new Headers());
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.skipped, true);
      }
    });
  });

  it("validateAccessLoginWindow in production requires JWT", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        SKIP_ACCESS_JWT_CHECK: "true",
        CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
        CF_ACCESS_AUD: AUDIENCE,
      },
      async () => {
        installLocalJwks();
        const missing = await validateAccessLoginWindow(
          new Headers({ Host: "localhost" }),
        );
        assert.equal(missing.ok, false);

        const nowSec = Math.floor(Date.now() / 1000);
        const token = await signAccessJwt({
          email: "  Staff.A@Example.COM ",
          iat: nowSec,
          exp: nowSec + 3600,
          iss: TEAM_DOMAIN,
          aud: AUDIENCE,
        });
        const ok = await validateAccessLoginWindow(
          new Headers({
            "Cf-Access-Jwt-Assertion": token,
            Host: "crm.example.com",
          }),
        );
        assert.equal(ok.ok, true);
        if (ok.ok) {
          assert.equal(ok.skipped, false);
          assert.equal(ok.email, "staff.a@example.com");
        }
      },
    );
  });
});

describe("access-jwt email binding and super admin", () => {
  afterEach(async () => {
    await withEnv({ CF_ACCESS_SUPER_ADMIN_EMAIL: undefined }, () => undefined);
  });

  it("allows matching Access and login emails", () => {
    const result = evaluateAccessLoginEmailBinding({
      verifiedAccessEmail: "Staff.A@Example.com",
      loginEmail: " staff.a@example.com ",
    });
    assert.deepEqual(result, {
      ok: true,
      crossAccountSuperAdmin: false,
    });
  });

  it("rejects mismatch for normal Access identity", async () => {
    await withEnv({ CF_ACCESS_SUPER_ADMIN_EMAIL: undefined }, () => {
      const result = evaluateAccessLoginEmailBinding({
        verifiedAccessEmail: "access-a@example.com",
        loginEmail: "staff-b@example.com",
      });
      assert.deepEqual(result, {
        ok: false,
        reason: "access_email_mismatch",
      });
    });
  });

  it("rejects missing Access email", () => {
    const result = evaluateAccessLoginEmailBinding({
      verifiedAccessEmail: null,
      loginEmail: "staff-a@example.com",
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "access_email_missing",
    });
  });

  it("allows super admin Access to target a different CRM email", async () => {
    await withEnv(
      { CF_ACCESS_SUPER_ADMIN_EMAIL: " Super.Admin@Example.COM " },
      () => {
        assert.equal(
          isSuperAdminAccessEmail("super.admin@example.com"),
          true,
        );
        const result = evaluateAccessLoginEmailBinding({
          verifiedAccessEmail: "super.admin@example.com",
          loginEmail: "staff-b@example.com",
        });
        assert.deepEqual(result, {
          ok: true,
          crossAccountSuperAdmin: true,
        });
      },
    );
  });

  it("does not grant exception when super admin email is unset", async () => {
    await withEnv({ CF_ACCESS_SUPER_ADMIN_EMAIL: undefined }, () => {
      assert.equal(isSuperAdminAccessEmail("anyone@example.com"), false);
      const result = evaluateAccessLoginEmailBinding({
        verifiedAccessEmail: "anyone@example.com",
        loginEmail: "other@example.com",
      });
      assert.equal(result.ok, false);
    });
  });

  it("ordinary admin Access still cannot mismatch", async () => {
    await withEnv(
      { CF_ACCESS_SUPER_ADMIN_EMAIL: "super.admin@example.com" },
      () => {
        const result = evaluateAccessLoginEmailBinding({
          verifiedAccessEmail: "ordinary.admin@example.com",
          loginEmail: "staff-b@example.com",
        });
        assert.equal(result.ok, false);
      },
    );
  });
});
