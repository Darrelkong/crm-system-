import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { config as middlewareConfig } from "@/middleware";
import {
  getRoleDashboardPath,
  isAdminGuardedPath,
  resolveAdminGuardedRouteDecision,
  shouldValidateSessionWithoutTouch,
} from "./auth";

const STAFF = { role: "staff" as const };
const ADMIN = { role: "admin" as const };

function staffAdminRedirect(pathname: string) {
  const decision = resolveAdminGuardedRouteDecision(pathname, STAFF);
  assert.equal(decision?.kind, "redirect_staff");
  return "/staff";
}

describe("isAdminGuardedPath", () => {
  it("includes admin dashboard and nested admin routes", () => {
    assert.equal(isAdminGuardedPath("/admin"), true);
    assert.equal(isAdminGuardedPath("/admin/settings"), true);
    assert.equal(
      isAdminGuardedPath("/admin/reclamation/collaborative-dry-run"),
      true,
    );
  });

  it("excludes staff, welcome, and login paths", () => {
    assert.equal(isAdminGuardedPath("/staff"), false);
    assert.equal(isAdminGuardedPath("/welcome"), false);
    assert.equal(isAdminGuardedPath("/login"), false);
  });
});

describe("resolveAdminGuardedRouteDecision staff session", () => {
  it("redirects /admin to /staff", () => {
    assert.equal(staffAdminRedirect("/admin"), "/staff");
  });

  it("redirects /admin/settings to /staff", () => {
    assert.equal(staffAdminRedirect("/admin/settings"), "/staff");
  });

  it("redirects /admin/reclamation/collaborative-dry-run to /staff", () => {
    assert.equal(
      staffAdminRedirect("/admin/reclamation/collaborative-dry-run"),
      "/staff",
    );
  });

  it("does not redirect staff on /staff or /welcome", () => {
    assert.equal(resolveAdminGuardedRouteDecision("/staff", STAFF), null);
    assert.equal(resolveAdminGuardedRouteDecision("/welcome", STAFF), null);
  });
});

describe("resolveAdminGuardedRouteDecision admin session", () => {
  it("allows /admin for admin", () => {
    assert.deepEqual(resolveAdminGuardedRouteDecision("/admin", ADMIN), {
      kind: "allow_admin",
    });
  });
});

describe("resolveAdminGuardedRouteDecision unauthenticated", () => {
  it("requires login for /admin", () => {
    assert.deepEqual(resolveAdminGuardedRouteDecision("/admin", null), {
      kind: "require_login",
    });
  });
});

describe("redirect targets", () => {
  it("staff redirect destination is not the original admin path", () => {
    const destination = staffAdminRedirect("/admin/settings");
    assert.notEqual(destination, "/admin/settings");
    assert.notEqual(destination, "/admin");
  });

  it("staff redirect does not send users to welcome or login", () => {
    const destination = staffAdminRedirect("/admin");
    assert.notEqual(destination, "/welcome");
    assert.notEqual(destination, "/login");
  });

  it("logged-in staff dashboard path is /staff not /admin", () => {
    assert.equal(getRoleDashboardPath("staff"), "/staff");
  });
});

describe("session touch policy for admin guarded paths", () => {
  it("uses touch:false validation path for admin guarded URLs", () => {
    assert.equal(shouldValidateSessionWithoutTouch("/admin"), true);
    assert.equal(shouldValidateSessionWithoutTouch("/admin/settings"), true);
    assert.equal(shouldValidateSessionWithoutTouch("/staff"), false);
  });
});

describe("middleware matcher coverage", () => {
  const matcher = middlewareConfig.matcher;

  it("includes /admin, /staff, /welcome, and /login", () => {
    assert.equal(matcher.includes("/admin"), true);
    assert.equal(matcher.includes("/admin/:path*"), true);
    assert.equal(matcher.includes("/staff"), true);
    assert.equal(matcher.includes("/staff/:path*"), true);
    assert.equal(matcher.includes("/welcome"), true);
    assert.equal(matcher.includes("/login"), true);
  });
});
