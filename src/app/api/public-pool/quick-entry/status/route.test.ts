import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthError } from "@/lib/permissions/auth";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  handleQuickEntryStatusGet,
  type QuickEntryStatusRouteDeps,
} from "@/app/api/public-pool/quick-entry/status/route";
import type { QuickEntryGrantStatus } from "@/lib/public-pool/quick-entry-security";
import type { User } from "../../../../../../drizzle/schema/users";

const staffUser = {
  id: SEED_IDS.staffA,
  role: "staff",
  displayName: "Staff",
} as User;

function makeDeps(overrides: {
  authError?: AuthError;
  status?: QuickEntryGrantStatus;
}): QuickEntryStatusRouteDeps {
  return {
    requireAuthSession: async () => {
      if (overrides.authError) throw overrides.authError;
      return { user: staffUser, sessionId: "sess-status-1" };
    },
    getQuickEntryGrantStatusForSession: async () =>
      overrides.status ?? {
        enabled: true,
        hasCode: true,
        grantActive: true,
        grantExpiresAt: "2026-07-20T12:30:00.000Z",
        locked: false,
        lockedUntil: null,
        retryAfterSeconds: null,
      },
  };
}

describe("GET /api/public-pool/quick-entry/status", () => {
  it("unauthenticated → 401", async () => {
    const deps = makeDeps({
      authError: new AuthError(
        401,
        "未登录",
        undefined,
        AUTH_ERROR_CODES.UNAUTHENTICATED,
      ),
    });
    const res = await handleQuickEntryStatusGet(deps);
    assert.equal(res.status, 401);
  });

  it("returns safe grant status fields only", async () => {
    const deps = makeDeps({});
    const res = await handleQuickEntryStatusGet(deps);
    assert.equal(res.status, 200);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.enabled, true);
    assert.equal(json.grantActive, true);
    assert.equal("failedAttempts" in json, false);
    assert.equal("grantVersion" in json, false);
    assert.equal("sessionId" in json, false);
    assert.equal("codeHash" in json, false);
  });

  it("disabled / locked shapes", async () => {
    const disabled = await handleQuickEntryStatusGet(
      makeDeps({
        status: {
          enabled: false,
          hasCode: true,
          grantActive: false,
          grantExpiresAt: null,
          locked: false,
          lockedUntil: null,
          retryAfterSeconds: null,
        },
      }),
    );
    const disabledJson = (await disabled.json()) as {
      enabled: boolean;
      grantActive: boolean;
    };
    assert.equal(disabledJson.enabled, false);
    assert.equal(disabledJson.grantActive, false);

    const locked = await handleQuickEntryStatusGet(
      makeDeps({
        status: {
          enabled: true,
          hasCode: true,
          grantActive: false,
          grantExpiresAt: null,
          locked: true,
          lockedUntil: "2026-07-20T12:15:00.000Z",
          retryAfterSeconds: 900,
        },
      }),
    );
    const lockedJson = (await locked.json()) as {
      locked: boolean;
      retryAfterSeconds: number;
    };
    assert.equal(lockedJson.locked, true);
    assert.equal(lockedJson.retryAfterSeconds, 900);
  });
});
