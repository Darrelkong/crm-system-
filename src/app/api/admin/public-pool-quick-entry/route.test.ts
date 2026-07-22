import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthError } from "@/lib/permissions/auth";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  handleAdminQuickEntryGet,
  handleAdminQuickEntryPost,
  type AdminQuickEntryRouteDeps,
} from "@/app/api/admin/public-pool-quick-entry/route";
import {
  QuickEntrySettingsError,
  type QuickEntryAdminState,
} from "@/lib/public-pool/quick-entry-settings";
import { QUICK_ENTRY_ERROR_CODES } from "@/lib/public-pool/quick-entry-constants";
import type { User } from "../../../../../drizzle/schema/users";

const adminUser = {
  id: SEED_IDS.admin,
  role: "admin",
  displayName: "Admin",
} as User;

const staffUser = {
  id: SEED_IDS.staffA,
  role: "staff",
  displayName: "Staff",
} as User;

const safeState: QuickEntryAdminState = {
  enabled: false,
  hasCode: true,
  codeUpdatedAt: "2026-07-20T00:00:00.000Z",
  updatedBy: { userId: SEED_IDS.admin, name: "Admin" },
};

function makeDeps(overrides: {
  user?: User;
  authError?: AuthError;
  state?: QuickEntryAdminState;
  setCodeError?: QuickEntrySettingsError;
  setEnabledError?: QuickEntrySettingsError;
}): {
  deps: AdminQuickEntryRouteDeps;
  setCodeCalls: Array<{ code: string; confirmCode: string }>;
  setEnabledCalls: boolean[];
} {
  const setCodeCalls: Array<{ code: string; confirmCode: string }> = [];
  const setEnabledCalls: boolean[] = [];
  const deps: AdminQuickEntryRouteDeps = {
    requireAdmin: async () => {
      if (overrides.authError) throw overrides.authError;
      const user = overrides.user ?? adminUser;
      if (user.role !== "admin") {
        throw new AuthError(403, "需要管理员权限");
      }
      return user;
    },
    getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
    getQuickEntryAdminState: async () => overrides.state ?? safeState,
    setQuickEntryCode: async (_actor, code, confirmCode) => {
      if (overrides.setCodeError) throw overrides.setCodeError;
      setCodeCalls.push({ code, confirmCode });
      return overrides.state ?? { ...safeState, hasCode: true };
    },
    setQuickEntryEnabled: async (_actor, enabled) => {
      if (overrides.setEnabledError) throw overrides.setEnabledError;
      setEnabledCalls.push(enabled);
      return overrides.state ?? { ...safeState, enabled };
    },
  };
  return { deps, setCodeCalls, setEnabledCalls };
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/public-pool-quick-entry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /api/admin/public-pool-quick-entry", () => {
  it("unauthenticated → 401", async () => {
    const { deps } = makeDeps({
      authError: new AuthError(
        401,
        "未登录",
        undefined,
        AUTH_ERROR_CODES.UNAUTHENTICATED,
      ),
    });
    const res = await handleAdminQuickEntryGet(
      new Request("http://localhost/api/admin/public-pool-quick-entry"),
      deps,
    );
    assert.equal(res.status, 401);
  });

  it("staff → 403", async () => {
    const { deps } = makeDeps({ user: staffUser });
    const res = await handleAdminQuickEntryGet(
      new Request("http://localhost/api/admin/public-pool-quick-entry"),
      deps,
    );
    assert.equal(res.status, 403);
  });

  it("admin GET returns safe state without hash", async () => {
    const { deps } = makeDeps({});
    const res = await handleAdminQuickEntryGet(
      new Request("http://localhost/api/admin/public-pool-quick-entry"),
      deps,
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.enabled, false);
    assert.equal(json.hasCode, true);
    assert.equal("codeHash" in json, false);
    assert.equal("code" in json, false);
    assert.equal("hash" in json, false);
  });
});

describe("POST /api/admin/public-pool-quick-entry", () => {
  it("set_code success", async () => {
    const { deps, setCodeCalls } = makeDeps({});
    const res = await handleAdminQuickEntryPost(
      postRequest({
        action: "set_code",
        code: "ValidCode1",
        confirmCode: "ValidCode1",
      }),
      deps,
    );
    assert.equal(res.status, 200);
    assert.equal(setCodeCalls.length, 1);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.ok, true);
    assert.equal("codeHash" in json, false);
  });

  it("confirmation mismatch", async () => {
    const { deps } = makeDeps({
      setCodeError: new QuickEntrySettingsError(
        QUICK_ENTRY_ERROR_CODES.CODE_CONFIRMATION_MISMATCH,
        "mismatch",
        400,
      ),
    });
    const res = await handleAdminQuickEntryPost(
      postRequest({
        action: "set_code",
        code: "ValidCode1",
        confirmCode: "ValidCode2",
      }),
      deps,
    );
    assert.equal(res.status, 400);
    const json = (await res.json()) as { errorCode: string };
    assert.equal(
      json.errorCode,
      QUICK_ENTRY_ERROR_CODES.CODE_CONFIRMATION_MISMATCH,
    );
  });

  it("invalid format", async () => {
    const { deps } = makeDeps({
      setCodeError: new QuickEntrySettingsError(
        QUICK_ENTRY_ERROR_CODES.CODE_INVALID_FORMAT,
        "bad",
        400,
      ),
    });
    const res = await handleAdminQuickEntryPost(
      postRequest({ action: "set_code", code: "bad", confirmCode: "bad" }),
      deps,
    );
    assert.equal(res.status, 400);
  });

  it("set_enabled true / enable without code", async () => {
    const { deps, setEnabledCalls } = makeDeps({});
    const ok = await handleAdminQuickEntryPost(
      postRequest({ action: "set_enabled", enabled: true }),
      deps,
    );
    assert.equal(ok.status, 200);
    assert.deepEqual(setEnabledCalls, [true]);

    const { deps: deps2 } = makeDeps({
      setEnabledError: new QuickEntrySettingsError(
        QUICK_ENTRY_ERROR_CODES.CODE_NOT_CONFIGURED,
        "missing",
        409,
      ),
    });
    const denied = await handleAdminQuickEntryPost(
      postRequest({ action: "set_enabled", enabled: true }),
      deps2,
    );
    assert.equal(denied.status, 409);
  });

  it("disable success", async () => {
    const { deps, setEnabledCalls } = makeDeps({});
    const res = await handleAdminQuickEntryPost(
      postRequest({ action: "set_enabled", enabled: false }),
      deps,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(setEnabledCalls, [false]);
  });

  it("unknown action / invalid JSON", async () => {
    const { deps, setCodeCalls, setEnabledCalls } = makeDeps({});
    const unknown = await handleAdminQuickEntryPost(
      postRequest({ action: "rotate" }),
      deps,
    );
    assert.equal(unknown.status, 400);
    assert.equal(setCodeCalls.length, 0);
    assert.equal(setEnabledCalls.length, 0);

    const badJson = await handleAdminQuickEntryPost(
      postRequest("{not-json"),
      deps,
    );
    assert.equal(badJson.status, 400);
  });

  it("enabled must be boolean", async () => {
    const { deps, setEnabledCalls } = makeDeps({});
    const res = await handleAdminQuickEntryPost(
      postRequest({ action: "set_enabled", enabled: "true" }),
      deps,
    );
    assert.equal(res.status, 400);
    assert.equal(setEnabledCalls.length, 0);
  });
});
