import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthError } from "@/lib/permissions/auth";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  handleQuickEntryVerifyPost,
  type QuickEntryVerifyRouteDeps,
} from "@/app/api/public-pool/quick-entry/verify/route";
import { QuickEntrySecurityError } from "@/lib/public-pool/quick-entry-security";
import { QUICK_ENTRY_ERROR_CODES } from "@/lib/public-pool/quick-entry-constants";
import type { User } from "../../../../../../drizzle/schema/users";

const staffUser = {
  id: SEED_IDS.staffA,
  role: "staff",
  displayName: "Staff",
} as User;

const adminUser = {
  id: SEED_IDS.admin,
  role: "admin",
  displayName: "Admin",
} as User;

function makeDeps(overrides: {
  user?: User;
  authError?: AuthError;
  verifyError?: QuickEntrySecurityError;
  grantExpiresAt?: string;
}): {
  deps: QuickEntryVerifyRouteDeps;
  verifyCodes: unknown[];
} {
  const verifyCodes: unknown[] = [];
  const deps: QuickEntryVerifyRouteDeps = {
    requireAuthSession: async () => {
      if (overrides.authError) throw overrides.authError;
      return {
        user: overrides.user ?? staffUser,
        sessionId: "sess-verify-1",
      };
    },
    getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
    verifyQuickEntryCode: async (input) => {
      verifyCodes.push(input.code);
      if (overrides.verifyError) throw overrides.verifyError;
      return {
        ok: true,
        grantExpiresAt:
          overrides.grantExpiresAt ?? "2026-07-20T12:30:00.000Z",
      };
    },
  };
  return { deps, verifyCodes };
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/public-pool/quick-entry/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/public-pool/quick-entry/verify", () => {
  it("unauthenticated → 401", async () => {
    const { deps, verifyCodes } = makeDeps({
      authError: new AuthError(
        401,
        "未登录",
        undefined,
        AUTH_ERROR_CODES.UNAUTHENTICATED,
      ),
    });
    const res = await handleQuickEntryVerifyPost(postRequest({ code: "x" }), deps);
    assert.equal(res.status, 401);
    assert.equal(verifyCodes.length, 0);
  });

  it("success for staff and admin (no bypass path)", async () => {
    for (const user of [staffUser, adminUser]) {
      const { deps } = makeDeps({ user });
      const res = await handleQuickEntryVerifyPost(
        postRequest({ code: "ValidCode1" }),
        deps,
      );
      assert.equal(res.status, 200);
      const json = (await res.json()) as Record<string, unknown>;
      assert.equal(json.ok, true);
      assert.equal(typeof json.grantExpiresAt, "string");
      assert.equal("codeHash" in json, false);
    }
  });

  it("rejects extra fields / invalid JSON / non-object", async () => {
    const { deps, verifyCodes } = makeDeps({});
    const extra = await handleQuickEntryVerifyPost(
      postRequest({ code: "ValidCode1", grantVersion: 1 }),
      deps,
    );
    assert.equal(extra.status, 400);
    assert.equal(verifyCodes.length, 0);

    const bad = await handleQuickEntryVerifyPost(postRequest("{"), deps);
    assert.equal(bad.status, 400);

    const arr = await handleQuickEntryVerifyPost(postRequest(["ValidCode1"]), deps);
    assert.equal(arr.status, 400);
  });

  it("maps disabled / invalid / rate limited errors", async () => {
    const disabled = await handleQuickEntryVerifyPost(
      postRequest({ code: "ValidCode1" }),
      makeDeps({
        verifyError: new QuickEntrySecurityError(
          QUICK_ENTRY_ERROR_CODES.DISABLED,
          "off",
          403,
        ),
      }).deps,
    );
    assert.equal(disabled.status, 403);

    const invalid = await handleQuickEntryVerifyPost(
      postRequest({ code: "WrongCode1" }),
      makeDeps({
        verifyError: new QuickEntrySecurityError(
          QUICK_ENTRY_ERROR_CODES.CODE_INVALID,
          "bad",
          403,
        ),
      }).deps,
    );
    assert.equal(invalid.status, 403);

    const limited = await handleQuickEntryVerifyPost(
      postRequest({ code: "WrongCode1" }),
      makeDeps({
        verifyError: new QuickEntrySecurityError(
          QUICK_ENTRY_ERROR_CODES.RATE_LIMITED,
          "lock",
          429,
          900,
        ),
      }).deps,
    );
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "900");
    const json = (await limited.json()) as {
      errorCode: string;
      retryAfterSeconds: number;
      ok: boolean;
    };
    assert.equal(json.ok, false);
    assert.equal(json.errorCode, QUICK_ENTRY_ERROR_CODES.RATE_LIMITED);
    assert.equal(json.retryAfterSeconds, 900);
  });

  it("code not configured → 409", async () => {
    const res = await handleQuickEntryVerifyPost(
      postRequest({ code: "ValidCode1" }),
      makeDeps({
        verifyError: new QuickEntrySecurityError(
          QUICK_ENTRY_ERROR_CODES.CODE_NOT_CONFIGURED,
          "missing",
          409,
        ),
      }).deps,
    );
    assert.equal(res.status, 409);
  });
});
