import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACCESS_REVERIFY_LOGIN_PATH,
  getAccessReverifyRedirectPath,
  parseBroadcastLogoutReason,
  parseSessionEndReason,
  sessionEndMessageKey,
  sessionEndShowsModal,
  shouldInspectSessionApiResponse,
} from "@/lib/auth/client-security";
import { CLOUDFLARE_ACCESS_LOGOUT_PATH } from "@/lib/auth/logout-redirect";

describe("parseSessionEndReason", () => {
  it("maps SESSION_ACCESS_REVERIFY_REQUIRED to access_reverify", () => {
    assert.equal(
      parseSessionEndReason("SESSION_ACCESS_REVERIFY_REQUIRED"),
      "access_reverify",
    );
  });

  it("keeps existing error code mappings", () => {
    assert.equal(parseSessionEndReason("SESSION_IDLE_EXPIRED"), "idle");
    assert.equal(parseSessionEndReason("SESSION_REVOKED"), "revoked");
    assert.equal(parseSessionEndReason("SESSION_INVALID"), "invalid");
    assert.equal(
      parseSessionEndReason("SESSION_DEVICE_REVOKED"),
      "device_revoked",
    );
  });

  it("does not map unrelated codes", () => {
    assert.equal(parseSessionEndReason("ACCOUNT_LOCKED"), null);
    assert.equal(parseSessionEndReason(undefined), null);
  });
});

describe("access reverify redirect paths", () => {
  it("uses Access logout path in production (non-local)", () => {
    assert.equal(
      getAccessReverifyRedirectPath(false),
      CLOUDFLARE_ACCESS_LOGOUT_PATH,
    );
    assert.ok(!getAccessReverifyRedirectPath(false).includes("reason=timeout"));
    assert.ok(
      !getAccessReverifyRedirectPath(false).includes("session_end=revoked"),
    );
  });

  it("uses dedicated login query in local development", () => {
    assert.equal(getAccessReverifyRedirectPath(true), ACCESS_REVERIFY_LOGIN_PATH);
    assert.equal(
      ACCESS_REVERIFY_LOGIN_PATH,
      "/login?session_end=access_reverify",
    );
    assert.ok(!ACCESS_REVERIFY_LOGIN_PATH.includes("reason=timeout"));
  });
});

describe("session end modal / message keys", () => {
  it("access_reverify does not show modal", () => {
    assert.equal(sessionEndShowsModal("access_reverify"), false);
    assert.equal(sessionEndShowsModal("idle"), true);
    assert.equal(sessionEndShowsModal("revoked"), true);
  });

  it("uses dedicated message key for access_reverify", () => {
    assert.equal(
      sessionEndMessageKey("access_reverify"),
      "security.accessReverifyRequired",
    );
    assert.equal(
      sessionEndMessageKey("idle"),
      "security.sessionTimedOutReLogin",
    );
    assert.equal(
      sessionEndMessageKey("revoked"),
      "security.sessionRevokedByOtherDevice",
    );
  });
});

describe("parseBroadcastLogoutReason", () => {
  it("preserves access_reverify and does not fold to idle", () => {
    assert.equal(parseBroadcastLogoutReason("access_reverify"), "access_reverify");
    assert.notEqual(parseBroadcastLogoutReason("access_reverify"), "idle");
  });

  it("preserves device_revoked and other reasons", () => {
    assert.equal(parseBroadcastLogoutReason("device_revoked"), "device_revoked");
    assert.equal(parseBroadcastLogoutReason("revoked"), "revoked");
    assert.equal(parseBroadcastLogoutReason("invalid"), "invalid");
    assert.equal(parseBroadcastLogoutReason("idle"), "idle");
  });

  it("ignores manual (no re-broadcast loop target)", () => {
    assert.equal(parseBroadcastLogoutReason("manual"), null);
  });
});

describe("shouldInspectSessionApiResponse", () => {
  it("inspects protected API 401s", () => {
    assert.equal(shouldInspectSessionApiResponse("/api/customers"), true);
    assert.equal(shouldInspectSessionApiResponse("/api/auth/me"), true);
  });

  it("excludes login and logout to avoid recursion", () => {
    assert.equal(shouldInspectSessionApiResponse("/api/auth/login"), false);
    assert.equal(shouldInspectSessionApiResponse("/api/auth/logout"), false);
  });

  it("ignores non-api URLs", () => {
    assert.equal(shouldInspectSessionApiResponse("/staff"), false);
  });
});
