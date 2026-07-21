import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  handleIdClaimPost,
  type IdClaimRouteDeps,
} from "@/app/api/public-pool/customers/[id]/claim/route";
import type { User } from "../../../../../drizzle/schema/users";
import type { Customer } from "../../../../../drizzle/schema/customers";

const staffUser = {
  id: SEED_IDS.staffA,
  role: "staff",
  displayName: "Staff A",
} as User;

const adminUser = {
  id: SEED_IDS.admin,
  role: "admin",
  displayName: "Admin",
} as User;

function makeRequest(): Request {
  return new Request(
    "http://localhost/api/public-pool/customers/missing-id/claim",
    { method: "POST" },
  );
}

function makeDeps(overrides: {
  user: User;
  customer?: Customer | null;
}): {
  deps: IdClaimRouteDeps;
  getCustomerCalls: string[];
  stats: { claimCalls: number };
  audits: Array<{ action: string; entityId: string | null }>;
} {
  const getCustomerCalls: string[] = [];
  const stats = { claimCalls: 0 };
  const audits: Array<{ action: string; entityId: string | null }> = [];

  const deps: IdClaimRouteDeps = {
    requireAuth: async () => overrides.user,
    getRequestMeta: () => ({
      ipAddress: "127.0.0.1",
      userAgent: "id-claim-route-test",
    }),
    getCustomerById: async (id) => {
      getCustomerCalls.push(id);
      return overrides.customer === undefined ? null : overrides.customer;
    },
    claimCustomerFromPool: async () => {
      stats.claimCalls += 1;
      return { ok: true, taskId: "task-admin-1" };
    },
    writeAuditLog: async (entry) => {
      audits.push({
        action: entry.action,
        entityId: entry.entityId ?? null,
      });
    },
    getStaffClaimStatus: async () => {
      throw new Error("staff status should not run for gated staff path");
    },
  };

  return { deps, getCustomerCalls, stats, audits };
}

describe("POST /api/public-pool/customers/[id]/claim staff gate", () => {
  it("staff: 403 CLAIM_METHOD_NOT_ALLOWED before customer query", async () => {
    const { deps, getCustomerCalls, stats, audits } = makeDeps({
      user: staffUser,
    });
    const res = await handleIdClaimPost(
      makeRequest(),
      { params: Promise.resolve({ id: "missing-or-any-id" }) },
      deps,
    );
    assert.equal(res.status, 403);
    const json = (await res.json()) as { errorCode: string };
    assert.equal(json.errorCode, "CLAIM_METHOD_NOT_ALLOWED");
    assert.equal(getCustomerCalls.length, 0);
    assert.equal(stats.claimCalls, 0);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.action, "customer.claim_failed.method_not_allowed");
  });

  it("staff with nonexistent id: still 403 before customer query", async () => {
    const { deps, getCustomerCalls, stats } = makeDeps({
      user: staffUser,
      customer: null,
    });
    const res = await handleIdClaimPost(
      makeRequest(),
      { params: Promise.resolve({ id: "does-not-exist" }) },
      deps,
    );
    assert.equal(res.status, 403);
    const json = (await res.json()) as { errorCode: string };
    assert.equal(json.errorCode, "CLAIM_METHOD_NOT_ALLOWED");
    assert.equal(getCustomerCalls.length, 0);
    assert.equal(stats.claimCalls, 0);
  });

  it("admin: passes gate and can claim", async () => {
    const customer = {
      id: "pool-admin-1",
      status: "public_pool",
      ownerId: null,
      customerName: "Admin Claim Target",
    } as Customer;
    const { deps, getCustomerCalls, stats } = makeDeps({
      user: adminUser,
      customer,
    });
    deps.getStaffClaimStatus = async () => {
      throw new Error("admin should not load staff claim status");
    };

    const res = await handleIdClaimPost(
      makeRequest(),
      { params: Promise.resolve({ id: customer.id }) },
      deps,
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; id: string; taskId: string };
    assert.equal(json.ok, true);
    assert.equal(json.id, customer.id);
    assert.equal(json.taskId, "task-admin-1");
    assert.equal(getCustomerCalls.length, 1);
    assert.equal(getCustomerCalls[0], customer.id);
    assert.equal(stats.claimCalls, 1);
  });
});
