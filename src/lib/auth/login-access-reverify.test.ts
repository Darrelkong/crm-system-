import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("CRM login and Access session separation", () => {
  it("does not add a CRM-side Access age or login-count reauthentication gate", () => {
    const loginRoute = readFileSync(
      new URL("../../app/api/auth/login/route.ts", import.meta.url),
      "utf8",
    );
    const loginPage = readFileSync(
      new URL("../../app/(auth)/login/page.tsx", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(loginRoute, /ACCESS_LOGIN_WINDOW_MS/);
    assert.doesNotMatch(loginRoute, /resolveIdleReloginState/);
    assert.doesNotMatch(loginRoute, /evaluateStaffLoginAccessEpochGate/);
    assert.doesNotMatch(loginPage, /resolveIdleReloginState/);
  });

  it("keeps actual Access revalidation responses on the Access path", () => {
    const loginRoute = readFileSync(
      new URL("../../app/api/auth/login/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(loginRoute, /validateAccessLoginWindowFromRequest/);
    assert.match(loginRoute, /ACCESS_VERIFICATION_EXPIRED/);
    assert.match(loginRoute, /getPostLogoutRedirectPath/);
  });
});
