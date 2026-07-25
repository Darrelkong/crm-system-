import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthError } from "@/lib/permissions/auth";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  handleAdminAiEffectStatsGet,
  type AdminAiEffectStatsRouteDeps,
} from "@/app/api/admin/ai-effect-stats/route";
import { AiEffectStatsRequestError } from "@/lib/ai/customer-insights/ai-effect-stats-request";
import { AiEffectStatsDataLimitError } from "@/lib/ai/customer-insights/ai-effect-stats";
import { emptyAiEffectStatsResponse } from "@/lib/ai/customer-insights/ai-effect-stats-response";
import { parseAiEffectStatsRequest } from "@/lib/ai/customer-insights/ai-effect-stats-request";
import type { User } from "../../../../../drizzle/schema/users";
import type { Database } from "@/lib/db";

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

function makeDeps(overrides: {
  user?: User;
  authError?: AuthError;
  statsError?: unknown;
}): AdminAiEffectStatsRouteDeps {
  return {
    requireAdmin: async () => {
      if (overrides.authError) throw overrides.authError;
      const user = overrides.user ?? adminUser;
      if (user.role !== "admin") {
        throw new AuthError(403, "需要管理员权限");
      }
      return user;
    },
    getDb: () => ({}) as Database,
    getAiEffectStatsForAdmin: async (_db, _user, url) => {
      if (overrides.statsError) throw overrides.statsError;
      const parsed = parseAiEffectStatsRequest(url);
      return emptyAiEffectStatsResponse(parsed);
    },
  };
}

describe("GET /api/admin/ai-effect-stats route", () => {
  it("unauthenticated → 401", async () => {
    const res = await handleAdminAiEffectStatsGet(
      new Request("http://localhost/api/admin/ai-effect-stats"),
      makeDeps({
        authError: new AuthError(
          401,
          "未登录",
          undefined,
          AUTH_ERROR_CODES.UNAUTHENTICATED,
        ),
      }),
    );
    assert.equal(res.status, 401);
    const body = (await res.json()) as { errorCode?: string };
    assert.ok(!JSON.stringify(body).includes("SELECT "));
  });

  it("staff → 403", async () => {
    const res = await handleAdminAiEffectStatsGet(
      new Request("http://localhost/api/admin/ai-effect-stats"),
      makeDeps({ user: staffUser }),
    );
    assert.equal(res.status, 403);
  });

  it("admin → 200 empty stats without PII keys", async () => {
    const res = await handleAdminAiEffectStatsGet(
      new Request("http://localhost/api/admin/ai-effect-stats?range=30"),
      makeDeps({}),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal("recent" in body, false);
    assert.equal("customerName" in body, false);
    assert.equal(JSON.stringify(body).includes("sourceHash"), false);
  });

  it("invalid range → 400 with safe code", async () => {
    const res = await handleAdminAiEffectStatsGet(
      new Request("http://localhost/api/admin/ai-effect-stats?range=365"),
      makeDeps({}),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { errorCode?: string };
    assert.equal(body.errorCode, "INVALID_RANGE");
  });

  it("hard limit → 503 without partial stats", async () => {
    const res = await handleAdminAiEffectStatsGet(
      new Request("http://localhost/api/admin/ai-effect-stats"),
      makeDeps({ statsError: new AiEffectStatsDataLimitError() }),
    );
    assert.equal(res.status, 503);
    const body = (await res.json()) as {
      ok?: boolean;
      errorCode?: string;
      overview?: unknown;
    };
    assert.equal(body.errorCode, "AI_EFFECT_STATS_DATA_LIMIT_EXCEEDED");
    assert.equal(body.overview, undefined);
  });

  it("exports GET only at module surface", async () => {
    const mod = await import("@/app/api/admin/ai-effect-stats/route");
    assert.equal(typeof mod.GET, "function");
    assert.equal("POST" in mod, false);
    assert.equal("PUT" in mod, false);
    assert.equal("DELETE" in mod, false);
  });
});
