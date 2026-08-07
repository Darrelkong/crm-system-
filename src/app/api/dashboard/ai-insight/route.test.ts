import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthError } from "@/lib/permissions/auth";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  GET,
  handleDashboardAiInsightGet,
  type DashboardAiInsightRouteDeps,
} from "@/app/api/dashboard/ai-insight/route";
import type { User } from "../../../../../drizzle/schema/users";
import type { DashboardAiInsightResult } from "@/lib/ai/dashboard-insights/types";

const staffA = {
  id: SEED_IDS.staffA,
  role: "staff",
  displayName: "Staff A",
} as User;

const staffB = {
  id: SEED_IDS.staffB,
  role: "staff",
  displayName: "Staff B",
} as User;

const admin = {
  id: SEED_IDS.admin,
  role: "admin",
  displayName: "Admin",
} as User;

function makeRequest(query = ""): Request {
  return new Request(`http://localhost/api/dashboard/ai-insight${query}`, {
    method: "GET",
  });
}

function makeDeps(overrides: {
  user?: User;
  authError?: AuthError;
  result?: DashboardAiInsightResult;
}): {
  deps: DashboardAiInsightRouteDeps;
  calls: Array<{
    viewerId: string;
    insightType: string;
    forceRefresh?: boolean;
    locale: string;
  }>;
} {
  const calls: Array<{
    viewerId: string;
    insightType: string;
    forceRefresh?: boolean;
    locale: string;
  }> = [];

  const deps: DashboardAiInsightRouteDeps = {
    requireAuth: async () => {
      if (overrides.authError) throw overrides.authError;
      return overrides.user ?? staffA;
    },
    getDb: () => ({}) as never,
    generateDashboardAiInsight: async (input) => {
      calls.push({
        viewerId: input.viewer.id,
        insightType: input.insightType,
        forceRefresh: input.forceRefresh,
        locale: input.locale,
      });
      if (overrides.result) {
        return overrides.result;
      }
      if (input.insightType === "admin_management_brief") {
        const result: DashboardAiInsightResult = {
          status: "success",
          source: "system_fallback",
          payload: {
            insightType: "admin_management_brief",
            insight: {
              headline: "Admin brief",
              summary: "Summary",
              priorities: [],
              cautions: [],
            },
          },
        };
        return result;
      }
      const result: DashboardAiInsightResult = {
        status: "success",
        source: "system_fallback",
        payload: {
          insightType: "staff_today_actions",
          insight: {
            headline: "Staff actions",
            actions: [],
          },
        },
      };
      return result;
    },
  };

  return { deps, calls };
}

describe("GET /api/dashboard/ai-insight", () => {
  it("exposes GET handler", () => {
    assert.equal(typeof GET, "function");
    assert.equal(typeof handleDashboardAiInsightGet, "function");
  });

  it("returns 401 when unauthenticated", async () => {
    const { deps } = makeDeps({
      authError: new AuthError(401, "未登录"),
    });
    const res = await handleDashboardAiInsightGet(makeRequest(), deps);
    assert.equal(res.status, 401);
  });

  it("forces staff_today_actions for staff regardless of query", async () => {
    const { deps, calls } = makeDeps({ user: staffA });
    const res = await handleDashboardAiInsightGet(
      makeRequest("?insightType=admin_management_brief&userId=other&role=admin"),
      deps,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.insight.insightType, "staff_today_actions");
    assert.equal(calls[0]?.insightType, "staff_today_actions");
    assert.equal(calls[0]?.viewerId, staffA.id);
  });

  it("forces admin_management_brief for admin", async () => {
    const { deps, calls } = makeDeps({ user: admin });
    const res = await handleDashboardAiInsightGet(
      makeRequest("?insightType=staff_today_actions"),
      deps,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.insight.insightType, "admin_management_brief");
    assert.equal(calls[0]?.insightType, "admin_management_brief");
  });

  it("isolates staff viewers by session user id", async () => {
    const { deps: depsA, calls: callsA } = makeDeps({ user: staffA });
    const { deps: depsB, calls: callsB } = makeDeps({ user: staffB });
    await handleDashboardAiInsightGet(makeRequest(), depsA);
    await handleDashboardAiInsightGet(makeRequest(), depsB);
    assert.equal(callsA[0]?.viewerId, staffA.id);
    assert.equal(callsB[0]?.viewerId, staffB.id);
    assert.notEqual(callsA[0]?.viewerId, callsB[0]?.viewerId);
  });

  it("passes forceRefresh only when requested", async () => {
    const { deps, calls } = makeDeps({ user: staffA });
    await handleDashboardAiInsightGet(makeRequest("?forceRefresh=1"), deps);
    assert.equal(calls[0]?.forceRefresh, true);
  });

  it("does not expose fingerprint or secrets in JSON", async () => {
    const { deps } = makeDeps({
      user: staffA,
      result: {
        status: "success",
        source: "provider",
        fingerprint: "fp-secret",
        payload: {
          insightType: "staff_today_actions",
          insight: { headline: "H", actions: [] },
          resolvedActions: [
            {
              category: "follow_up",
              title: "T",
              reason: "R",
              urgency: "normal",
              customerId: "id-secret",
              customerHref: "/customers/id-secret",
              customerDisplayLabel: "客户 1",
            },
          ],
        },
      },
    });
    const res = await handleDashboardAiInsightGet(makeRequest(), deps);
    const text = await res.text();
    assert.doesNotMatch(text, /fp-secret/);
    assert.doesNotMatch(text, /"customerId"/);
    assert.doesNotMatch(text, /fingerprint/);
    assert.match(text, /客户 1/);
  });
});
