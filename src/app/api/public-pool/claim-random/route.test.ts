import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthError } from "@/lib/permissions/auth";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import type {
  ClaimRandomCustomerFailure,
  ClaimRandomCustomerResult,
} from "@/lib/public-pool/random-claim-service";
import {
  handleClaimRandomPost,
  POST,
  type ClaimRandomRouteDeps,
} from "@/app/api/public-pool/claim-random/route";
import type { User } from "../../../../../drizzle/schema/users";

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

function makeRequest(body?: string): Request {
  if (body === undefined) {
    return new Request("http://localhost/api/public-pool/claim-random", {
      method: "POST",
    });
  }
  return new Request("http://localhost/api/public-pool/claim-random", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function makeDeps(overrides: {
  user?: User;
  authError?: AuthError;
  claimResult?: ClaimRandomCustomerResult;
}): {
  deps: ClaimRandomRouteDeps;
  claimCalls: Array<{
    user: User;
    ipAddress?: string | null;
    userAgent?: string | null;
  }>;
} {
  const claimCalls: Array<{
    user: User;
    ipAddress?: string | null;
    userAgent?: string | null;
  }> = [];

  const deps: ClaimRandomRouteDeps = {
    requireAuth: async () => {
      if (overrides.authError) throw overrides.authError;
      return overrides.user ?? staffUser;
    },
    getRequestMeta: () => ({
      ipAddress: "127.0.0.1",
      userAgent: "route-test",
    }),
    claimRandomCustomerFromPoolForStaff: async (input) => {
      claimCalls.push({
        user: input.user,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      return (
        overrides.claimResult ?? {
          ok: true,
          customerId: "cust-1",
          customerCode: "C-001",
          customerName: "Test Customer",
          taskId: "task-1",
        }
      );
    },
  };

  return { deps, claimCalls };
}

describe("POST /api/public-pool/claim-random route handler", () => {
  it("exposes POST that delegates to handleClaimRandomPost", () => {
    assert.equal(typeof POST, "function");
    assert.equal(typeof handleClaimRandomPost, "function");
  });

  it("empty body: accepts and calls service once (not 400)", async () => {
    const { deps, claimCalls } = makeDeps({});
    const res = await handleClaimRandomPost(makeRequest(), deps);
    assert.equal(res.status, 200);
    assert.equal(claimCalls.length, 1);
    assert.equal(claimCalls[0]!.user.id, SEED_IDS.staffA);
    assert.equal(claimCalls[0]!.user.role, "staff");
  });

  it("empty JSON object: accepts and calls service once", async () => {
    const { deps, claimCalls } = makeDeps({});
    const res = await handleClaimRandomPost(makeRequest("{}"), deps);
    assert.equal(res.status, 200);
    assert.equal(claimCalls.length, 1);
  });

  it("invalid JSON: 400 INVALID_REQUEST_BODY and service not called", async () => {
    const { deps, claimCalls } = makeDeps({});
    const res = await handleClaimRandomPost(makeRequest("{invalid"), deps);
    assert.equal(res.status, 400);
    const json = (await res.json()) as { errorCode: string };
    assert.equal(json.errorCode, "INVALID_REQUEST_BODY");
    assert.equal(claimCalls.length, 0);
  });

  it("customerId body: 400 RANDOM_CLAIM_BODY_NOT_ALLOWED", async () => {
    const { deps, claimCalls } = makeDeps({});
    const res = await handleClaimRandomPost(
      makeRequest(JSON.stringify({ customerId: "customer-1" })),
      deps,
    );
    assert.equal(res.status, 400);
    const json = (await res.json()) as { errorCode: string };
    assert.equal(json.errorCode, "RANDOM_CLAIM_BODY_NOT_ALLOWED");
    assert.equal(claimCalls.length, 0);
  });

  it("limit body: 400 and service not called", async () => {
    const { deps, claimCalls } = makeDeps({});
    const res = await handleClaimRandomPost(
      makeRequest(JSON.stringify({ limit: 10 })),
      deps,
    );
    assert.equal(res.status, 400);
    const json = (await res.json()) as { errorCode: string };
    assert.equal(json.errorCode, "RANDOM_CLAIM_BODY_NOT_ALLOWED");
    assert.equal(claimCalls.length, 0);
  });

  it("admin: 403 RANDOM_CLAIM_STAFF_ONLY and service not called", async () => {
    const { deps, claimCalls } = makeDeps({ user: adminUser });
    const res = await handleClaimRandomPost(makeRequest("{}"), deps);
    assert.equal(res.status, 403);
    const json = (await res.json()) as { errorCode: string };
    assert.equal(json.errorCode, "RANDOM_CLAIM_STAFF_ONLY");
    assert.equal(claimCalls.length, 0);
  });

  it("staff success: exact response keys, no PII, uses session user", async () => {
    const { deps, claimCalls } = makeDeps({
      claimResult: {
        ok: true,
        customerId: "cust-1",
        customerCode: "C-001",
        customerName: "Test Customer",
        taskId: "task-1",
      },
    });
    const res = await handleClaimRandomPost(makeRequest(""), deps);
    assert.equal(res.status, 200);
    const json = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(json).sort(), [
      "customerCode",
      "customerId",
      "customerName",
      "ok",
      "taskId",
    ]);
    assert.equal(json.ok, true);
    assert.equal(json.customerId, "cust-1");
    assert.equal(json.customerCode, "C-001");
    assert.equal(json.customerName, "Test Customer");
    assert.equal(json.taskId, "task-1");
    assert.equal("phone" in json, false);
    assert.equal("email" in json, false);
    assert.equal("wechat" in json, false);
    assert.equal("address" in json, false);
    assert.equal("candidateIds" in json, false);
    assert.equal(claimCalls.length, 1);
    assert.equal(claimCalls[0]!.user.id, SEED_IDS.staffA);
    assert.equal(claimCalls[0]!.ipAddress, "127.0.0.1");
  });

  it("does not read userId/role from body", async () => {
    const { deps, claimCalls } = makeDeps({});
    const res = await handleClaimRandomPost(
      makeRequest(
        JSON.stringify({ userId: "attacker", role: "admin", customerId: "x" }),
      ),
      deps,
    );
    assert.equal(res.status, 400);
    assert.equal(claimCalls.length, 0);
  });

  it("auth failure: maps AuthError and does not call service", async () => {
    const { deps, claimCalls } = makeDeps({
      authError: new AuthError(
        401,
        "未登录",
        undefined,
        AUTH_ERROR_CODES.UNAUTHENTICATED,
      ),
    });
    const res = await handleClaimRandomPost(makeRequest("{}"), deps);
    assert.equal(res.status, 401);
    const json = (await res.json()) as { errorCode: string };
    assert.equal(json.errorCode, AUTH_ERROR_CODES.UNAUTHENTICATED);
    assert.equal(claimCalls.length, 0);
  });

  it("maps service errors to exact HTTP status and codes", async () => {
    const cases: ClaimRandomCustomerFailure[] = [
      {
        ok: false,
        errorCode: "CLAIM_COOLDOWN",
        httpStatus: 403,
        error: "cooldown",
      },
      {
        ok: false,
        errorCode: "CLAIM_QUOTA_EXCEEDED",
        httpStatus: 429,
        error: "quota",
      },
      {
        ok: false,
        errorCode: "PUBLIC_POOL_NO_ELIGIBLE_CUSTOMER",
        httpStatus: 404,
        error: "empty",
      },
      {
        ok: false,
        errorCode: "PUBLIC_POOL_CANDIDATE_SCAN_LIMIT",
        httpStatus: 503,
        error: "scan",
      },
      {
        ok: false,
        errorCode: "PUBLIC_POOL_RANDOM_CLAIM_CONFLICT",
        httpStatus: 409,
        error: "conflict",
      },
    ];

    for (const claimResult of cases) {
      const { deps, claimCalls } = makeDeps({ claimResult });
      const res = await handleClaimRandomPost(makeRequest("{}"), deps);
      assert.equal(res.status, claimResult.httpStatus, claimResult.errorCode);
      const json = (await res.json()) as { errorCode: string };
      assert.equal(json.errorCode, claimResult.errorCode);
      assert.equal(claimCalls.length, 1);
    }
  });
});
