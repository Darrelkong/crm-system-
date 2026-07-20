import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ACCESS_REVERIFY_SESSION_END,
  planAccessReverifyRedirect,
} from "@/lib/auth/access-reverify-redirect";
import {
  CLOUDFLARE_ACCESS_LOGOUT_PATH,
  getPostLogoutRedirectPath,
} from "@/lib/auth/logout-redirect";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

describe("planAccessReverifyRedirect — production", () => {
  it("uses Access logout kind (not CRM login)", () => {
    const plan = planAccessReverifyRedirect({
      nodeEnv: "production",
      pathname: "/staff",
    });
    assert.equal(plan.kind, "access_logout");
    assert.equal(plan.clearSessionCookie, true);
    assert.equal(plan.incrementIdleRelogin, false);
  });

  it("Access logout path matches getPostLogoutRedirectPath in production", () => {
    const prev = process.env.NODE_ENV;
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
    try {
      assert.equal(getPostLogoutRedirectPath(), CLOUDFLARE_ACCESS_LOGOUT_PATH);
      const plan = planAccessReverifyRedirect({
        nodeEnv: "production",
        pathname: "/customers",
      });
      assert.equal(plan.kind, "access_logout");
    } finally {
      (process.env as { NODE_ENV?: string }).NODE_ENV = prev;
    }
  });

  it("does not use reason=timeout or session_end=revoked/invalid/idle", () => {
    const plan = planAccessReverifyRedirect({
      nodeEnv: "production",
      pathname: "/staff",
    });
    assert.equal(plan.kind, "access_logout");
    assert.ok(!("destinationPath" in plan));
  });
});

describe("planAccessReverifyRedirect — development", () => {
  it("redirects protected pages to /login?session_end=access_reverify", () => {
    const plan = planAccessReverifyRedirect({
      nodeEnv: "development",
      pathname: "/staff",
    });
    assert.equal(plan.kind, "local_login");
    if (plan.kind !== "local_login") return;
    assert.equal(
      plan.destinationPath,
      `/login?session_end=${ACCESS_REVERIFY_SESSION_END}`,
    );
    assert.equal(plan.incrementIdleRelogin, false);
    assert.ok(!plan.destinationPath.includes("reason=timeout"));
    assert.ok(!plan.destinationPath.includes("session_end=revoked"));
    assert.ok(!plan.destinationPath.includes("session_end=invalid"));
    assert.ok(!plan.destinationPath.includes("session_end=idle"));
  });

  it("passthrough on /login to avoid infinite redirect", () => {
    const plan = planAccessReverifyRedirect({
      nodeEnv: "development",
      pathname: "/login",
    });
    assert.equal(plan.kind, "local_login_passthrough");
    assert.equal(plan.clearSessionCookie, true);
    assert.equal(plan.incrementIdleRelogin, false);
  });

  it("does not target Access logout in development", () => {
    const plan = planAccessReverifyRedirect({
      nodeEnv: "development",
      pathname: "/admin",
    });
    assert.notEqual(plan.kind, "access_logout");
    if (plan.kind === "local_login") {
      assert.ok(!plan.destinationPath.includes(CLOUDFLARE_ACCESS_LOGOUT_PATH));
    }
  });
});

describe("planAccessReverifyRedirect — cookie / idle policy", () => {
  it("always clears session cookie and never increments idle relogin", () => {
    for (const nodeEnv of ["production", "development"] as const) {
      for (const pathname of ["/staff", "/login", "/customers"]) {
        const plan = planAccessReverifyRedirect({ nodeEnv, pathname });
        assert.equal(plan.clearSessionCookie, true);
        assert.equal(plan.incrementIdleRelogin, false);
      }
    }
  });

  it("session cookie name remains the CRM session cookie", () => {
    assert.equal(SESSION_COOKIE_NAME, "crm_session");
  });
});

describe("middleware access_reverify wiring (source contract)", () => {
  const middlewareSrc = readFileSync(
    new URL("../../middleware.ts", import.meta.url),
    "utf8",
  );

  it("handles access_reverify via dedicated helper before idle/revoked branches", () => {
    assert.match(middlewareSrc, /reason === "access_reverify"/);
    assert.match(middlewareSrc, /buildAccessReverifyMiddlewareResponse/);
    const accessIdx = middlewareSrc.indexOf('reason === "access_reverify"');
    const idleIdx = middlewareSrc.indexOf('reason === "idle_expired"');
    const revokedIdx = middlewareSrc.indexOf('reason === "revoked"');
    assert.ok(accessIdx > 0 && idleIdx > accessIdx);
    assert.ok(revokedIdx > idleIdx);
  });

  it("keeps idle redirect using reason=timeout and idle-relogin increment", () => {
    assert.match(middlewareSrc, /sessionEnd === "idle"/);
    assert.match(middlewareSrc, /reason", "timeout"/);
    assert.match(middlewareSrc, /incrementIdleReloginOnResponse/);
  });

  it("keeps revoked / device_revoked / invalid session_end mapping", () => {
    assert.match(middlewareSrc, /sessionEndReason = "revoked"/);
    assert.match(middlewareSrc, /sessionEndReason = "device_revoked"/);
    assert.match(middlewareSrc, /sessionEndReason = "invalid"/);
  });

  it("does not fold access_reverify into SessionEndReason union", () => {
    assert.match(
      middlewareSrc,
      /type SessionEndReason = "idle" \| "revoked" \| "invalid" \| "device_revoked"/,
    );
    assert.equal(
      /type SessionEndReason =[^;]+;/.exec(middlewareSrc)?.[0].includes(
        "access_reverify",
      ),
      false,
    );
  });
});
