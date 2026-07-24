import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthError } from "@/lib/permissions/auth";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  handleAdminAiStaffUsageGet,
  type AdminAiStaffUsageRouteDeps,
} from "@/app/api/admin/ai-staff-usage/route";
import type { AdminStaffAiUsageStats } from "@/lib/ai/staff-usage/admin-stats";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
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

const sampleSettings = {
  aiEnabled: true,
  aiStaffDeepAnalysisEnabled: true,
  aiStaffDailyLimit: 3,
} as EffectiveAiSettings;

const sampleStats: AdminStaffAiUsageStats = {
  usageDate: "2026-07-20",
  staffDeepAnalysisEnabled: true,
  dailyLimit: 3,
  todaySuccessTotal: 1,
  todayActiveStaffCount: 1,
  staff: [
    {
      userId: SEED_IDS.staffA,
      displayName: "Staff A",
      used: 1,
      remaining: 2,
      dailyLimit: 3,
      status: "ok",
    },
  ],
  staffListLimit: 200,
  hasMore: false,
};

function makeDeps(overrides: {
  user?: User;
  authError?: AuthError;
  stats?: AdminStaffAiUsageStats;
}): AdminAiStaffUsageRouteDeps {
  return {
    requireAdmin: async () => {
      if (overrides.authError) throw overrides.authError;
      const user = overrides.user ?? adminUser;
      if (user.role !== "admin") {
        throw new AuthError(403, "需要管理员权限");
      }
      return user;
    },
    getEffectiveAiSettings: async () => sampleSettings,
    getAdminStaffAiUsageStats: async () => overrides.stats ?? sampleStats,
  };
}

describe("GET /api/admin/ai-staff-usage", () => {
  it("unauthenticated → 401", async () => {
    const deps = makeDeps({
      authError: new AuthError(
        401,
        "未登录",
        undefined,
        AUTH_ERROR_CODES.UNAUTHENTICATED,
      ),
    });
    const res = await handleAdminAiStaffUsageGet(
      new Request("http://localhost/api/admin/ai-staff-usage"),
      deps,
    );
    assert.equal(res.status, 401);
  });

  it("staff → 403", async () => {
    const deps = makeDeps({ user: staffUser });
    const res = await handleAdminAiStaffUsageGet(
      new Request("http://localhost/api/admin/ai-staff-usage"),
      deps,
    );
    assert.equal(res.status, 403);
  });

  it("admin → 200 with non-sensitive stats payload", async () => {
    const deps = makeDeps({});
    const res = await handleAdminAiStaffUsageGet(
      new Request("http://localhost/api/admin/ai-staff-usage"),
      deps,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { stats: AdminStaffAiUsageStats };
    assert.equal(body.stats.todaySuccessTotal, 1);
    assert.equal(body.stats.hasMore, false);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("password"), false);
    assert.equal(serialized.includes("@"), false);
    assert.equal(serialized.includes("phone"), false);
    assert.equal(serialized.includes("wechat"), false);
    assert.equal(serialized.includes("prompt"), false);
  });
});
