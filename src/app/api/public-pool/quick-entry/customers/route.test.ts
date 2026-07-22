import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthError } from "@/lib/permissions/auth";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  handleQuickEntryBatchCustomersPost,
  type QuickEntryBatchRouteDeps,
} from "@/app/api/public-pool/quick-entry/customers/route";
import { QuickEntrySecurityError } from "@/lib/public-pool/quick-entry-security";
import { QUICK_ENTRY_ERROR_CODES } from "@/lib/public-pool/quick-entry-constants";
import { QUICK_ENTRY_SUBMISSION_ERROR_CODES } from "@/lib/public-pool/quick-entry-submission-constants";
import { QuickEntrySubmissionError } from "@/lib/public-pool/quick-entry-submission-repository";
import type { QuickEntryBatchResult } from "@/lib/public-pool/quick-entry-batch-types";
import type { User } from "../../../../../../drizzle/schema/users";

const staffUser = {
  id: SEED_IDS.staffA,
  role: "staff",
  displayName: "Staff",
  isActive: 1,
  deletedAt: null,
  mustChangePassword: 0,
} as User;

const adminUser = {
  id: SEED_IDS.admin,
  role: "admin",
  displayName: "Admin",
  isActive: 1,
  deletedAt: null,
  mustChangePassword: 0,
} as User;

const validSubmissionId = "550e8400-e29b-41d4-a716-4466554400c1";
const validBody = {
  submissionId: validSubmissionId,
  rows: [
    {
      clientRowId: "row-1",
      customerName: "张三",
      phone: "13800138000",
      requestedProjectName: "加拿大移民项目",
    },
  ],
};

function successDomain(): QuickEntryBatchResult {
  return {
    ok: true,
    submissionId: validSubmissionId,
    replayed: false,
    summary: {
      total: 1,
      created: 1,
      duplicates: 0,
      invalid: 0,
      failed: 0,
    },
    results: [
      {
        clientRowId: "row-1",
        status: "created",
        customerId: "cust-1",
        customerCode: "EF000001",
        customerName: "张三",
      },
    ],
  };
}

function makeDeps(overrides: {
  user?: User;
  authError?: AuthError;
  grantError?: QuickEntrySecurityError;
  domainResult?: QuickEntryBatchResult;
  domainThrow?: unknown;
  auditThrow?: boolean;
  maxBodyBytes?: number;
}): {
  deps: QuickEntryBatchRouteDeps;
  domainCalls: unknown[];
  auditCalls: unknown[];
} {
  const domainCalls: unknown[] = [];
  const auditCalls: unknown[] = [];
  const deps: QuickEntryBatchRouteDeps = {
    requireAuthSession: async () => {
      if (overrides.authError) throw overrides.authError;
      return {
        user: overrides.user ?? staffUser,
        sessionId: "sess-batch-1",
      };
    },
    requireActiveQuickEntryGrant: async () => {
      if (overrides.grantError) throw overrides.grantError;
      return {
        grantExpiresAt: "2099-01-01T00:00:00.000Z",
        grantVersion: 1,
      };
    },
    getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
    processQuickEntryCustomerSubmission: async (input) => {
      domainCalls.push(input);
      if (overrides.domainThrow) throw overrides.domainThrow;
      return overrides.domainResult ?? successDomain();
    },
    writeAuditLog: async (input) => {
      if (overrides.auditThrow) throw new Error("audit failed");
      auditCalls.push(input);
    },
    maxBodyBytes: overrides.maxBodyBytes ?? 65536,
  };
  return { deps, domainCalls, auditCalls };
}

function postRequest(
  body: unknown,
  headers: Record<string, string> = { "content-type": "application/json" },
): Request {
  return new Request(
    "http://localhost/api/public-pool/quick-entry/customers",
    {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

describe("POST /api/public-pool/quick-entry/customers", () => {
  it("unauthenticated → 401", async () => {
    const { deps, domainCalls } = makeDeps({
      authError: new AuthError(
        401,
        "未登录",
        undefined,
        AUTH_ERROR_CODES.UNAUTHENTICATED,
      ),
    });
    const res = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      deps,
    );
    assert.equal(res.status, 401);
    assert.equal(domainCalls.length, 0);
  });

  it("mustChangePassword / invalid role / deleted → 403", async () => {
    const mustChange = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      makeDeps({
        authError: new AuthError(
          403,
          "must change password",
          "auth.must_change_password",
          AUTH_ERROR_CODES.MUST_CHANGE_PASSWORD,
        ),
      }).deps,
    );
    assert.equal(mustChange.status, 403);

    const badRole = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      makeDeps({
        user: { ...staffUser, role: "guest" as User["role"] },
      }).deps,
    );
    assert.equal(badRole.status, 403);

    const deleted = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      makeDeps({
        user: { ...staffUser, deletedAt: "2026-01-01T00:00:00.000Z" },
      }).deps,
    );
    assert.equal(deleted.status, 403);
  });

  it("staff and admin succeed when grant active", async () => {
    for (const user of [staffUser, adminUser]) {
      const { deps, domainCalls, auditCalls } = makeDeps({ user });
      const res = await handleQuickEntryBatchCustomersPost(
        postRequest(validBody),
        deps,
      );
      assert.equal(res.status, 200);
      const json = (await res.json()) as Record<string, unknown>;
      assert.equal(json.ok, true);
      assert.equal(json.replayed, false);
      assert.equal(domainCalls.length, 1);
      const call = domainCalls[0] as {
        actor: User;
        submissionId: string;
        rows: unknown[];
      };
      assert.equal(call.actor.id, user.id);
      assert.equal(call.submissionId, validSubmissionId);
      assert.equal("submissionDbId" in call, false);
      assert.equal("requestHash" in call, false);
      assert.equal(auditCalls.length, 1);
    }
  });

  it("admin without grant is rejected", async () => {
    const { deps, domainCalls } = makeDeps({
      user: adminUser,
      grantError: new QuickEntrySecurityError(
        QUICK_ENTRY_ERROR_CODES.GRANT_REQUIRED,
        "需要先验证快速录入密码",
        403,
      ),
    });
    const res = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      deps,
    );
    assert.equal(res.status, 403);
    const json = (await res.json()) as { errorCode: string };
    assert.equal(json.errorCode, QUICK_ENTRY_ERROR_CODES.GRANT_REQUIRED);
    assert.equal(domainCalls.length, 0);
  });

  it("maps grant disabled／expired／mismatch／locked", async () => {
    const cases = [
      {
        err: new QuickEntrySecurityError(
          QUICK_ENTRY_ERROR_CODES.DISABLED,
          "快速录入未启用",
          403,
        ),
        status: 403,
      },
      {
        err: new QuickEntrySecurityError(
          QUICK_ENTRY_ERROR_CODES.GRANT_EXPIRED,
          "快速录入授权已过期",
          403,
        ),
        status: 403,
      },
      {
        err: new QuickEntrySecurityError(
          QUICK_ENTRY_ERROR_CODES.GRANT_VERSION_MISMATCH,
          "快速录入授权已失效",
          403,
        ),
        status: 403,
      },
      {
        err: new QuickEntrySecurityError(
          QUICK_ENTRY_ERROR_CODES.RATE_LIMITED,
          "快速录入验证已锁定",
          429,
          60,
        ),
        status: 429,
      },
    ];
    for (const c of cases) {
      const res = await handleQuickEntryBatchCustomersPost(
        postRequest(validBody),
        makeDeps({ grantError: c.err }).deps,
      );
      assert.equal(res.status, c.status);
      const json = (await res.json()) as { errorCode: string };
      assert.equal(json.errorCode, c.err.errorCode);
    }
  });

  it("rejects wrong content-type／invalid JSON／oversized body", async () => {
    const wrongType = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody, { "content-type": "text/plain" }),
      makeDeps({}).deps,
    );
    assert.equal(wrongType.status, 415);

    const invalidJson = await handleQuickEntryBatchCustomersPost(
      postRequest("{bad", { "content-type": "application/json" }),
      makeDeps({}).deps,
    );
    assert.equal(invalidJson.status, 400);

    const oversized = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      makeDeps({ maxBodyBytes: 10 }).deps,
    );
    assert.equal(oversized.status, 413);
  });

  it("rejects unknown fields and system injections before domain", async () => {
    const { deps, domainCalls } = makeDeps({});
    for (const body of [
      { ...validBody, submissionDbId: "x" },
      { ...validBody, actorId: SEED_IDS.admin },
      {
        submissionId: validSubmissionId,
        rows: [{ ...validBody.rows[0], ownerId: null }],
      },
      { submissionId: validSubmissionId, rows: [] },
      {
        submissionId: validSubmissionId,
        rows: Array.from({ length: 21 }, (_, i) => ({
          ...validBody.rows[0],
          clientRowId: `r${i}`,
        })),
      },
    ]) {
      const res = await handleQuickEntryBatchCustomersPost(
        postRequest(body),
        deps,
      );
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(domainCalls.length, 0);
  });

  it("maps partial／replay／conflicts／processing／unknown errors", async () => {
    const partial = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      makeDeps({
        domainResult: {
          ok: true,
          submissionId: validSubmissionId,
          replayed: false,
          summary: {
            total: 2,
            created: 1,
            duplicates: 1,
            invalid: 0,
            failed: 0,
          },
          results: [
            {
              clientRowId: "a",
              status: "created",
              customerId: "c1",
              customerCode: "EF1",
              customerName: "甲",
            },
            {
              clientRowId: "b",
              status: "duplicate",
              errorCode: "QUICK_ENTRY_DUPLICATE_PHONE",
              duplicateField: "phone",
            },
          ],
        },
      }).deps,
    );
    assert.equal(partial.status, 200);
    const partialJson = (await partial.json()) as {
      ok: boolean;
      summary: { duplicates: number };
    };
    assert.equal(partialJson.ok, true);
    assert.equal(partialJson.summary.duplicates, 1);

    const replay = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      makeDeps({
        domainResult: {
          ok: true,
          submissionId: validSubmissionId,
          replayed: true,
          summary: {
            total: 1,
            created: 1,
            duplicates: 0,
            invalid: 0,
            failed: 0,
          },
          results: [
            {
              clientRowId: "row-1",
              status: "created",
              customerId: "cust-1",
              customerCode: "EF000001",
              customerName: "张三",
            },
          ],
        },
      }).deps,
    );
    assert.equal(replay.status, 200);
    assert.equal(((await replay.json()) as { replayed: boolean }).replayed, true);

    const conflict = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      makeDeps({
        domainResult: {
          ok: false,
          errorCode: QUICK_ENTRY_SUBMISSION_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          message: "冲突",
        },
      }).deps,
    );
    assert.equal(conflict.status, 409);

    const processing = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      makeDeps({
        domainThrow: new QuickEntrySubmissionError(
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_PROCESSING,
          "处理中",
          12,
        ),
      }).deps,
    );
    assert.equal(processing.status, 409);
    const processingJson = (await processing.json()) as {
      retryAfterSeconds: number;
      errorCode: string;
    };
    assert.equal(
      processingJson.errorCode,
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_PROCESSING,
    );
    assert.equal(processingJson.retryAfterSeconds, 12);
    assert.equal("processingStartedAt" in processingJson, false);

    const unknown = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      makeDeps({ domainThrow: new Error("d1 boom stack") }).deps,
    );
    assert.equal(unknown.status, 500);
    const unknownJson = (await unknown.json()) as {
      error: string;
      errorCode: string;
    };
    assert.equal(unknownJson.errorCode, "SERVER_ERROR");
    assert.equal(unknownJson.error.includes("d1"), false);
    assert.equal(unknownJson.error.includes("stack"), false);
  });

  it("result has no PII and audit failure does not break 200", async () => {
    const { deps, auditCalls } = makeDeps({ auditThrow: true });
    const res = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      deps,
    );
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text.includes("13800138000"), false);
    assert.equal(text.includes("phoneCountryCode"), false);
    assert.equal(text.includes("submissionDbId"), false);
    assert.equal(text.includes("requestHash"), false);
    assert.equal(auditCalls.length, 0);
  });

  it("audit metadata is safe on success", async () => {
    const { deps, auditCalls } = makeDeps({});
    const res = await handleQuickEntryBatchCustomersPost(
      postRequest(validBody),
      deps,
    );
    assert.equal(res.status, 200);
    assert.equal(auditCalls.length, 1);
    const meta = (auditCalls[0] as { metadata: Record<string, unknown> })
      .metadata;
    assert.deepEqual(Object.keys(meta).sort(), [
      "actorRole",
      "created",
      "duplicates",
      "failed",
      "invalid",
      "replayed",
      "submissionId",
      "total",
    ]);
    assert.equal(JSON.stringify(meta).includes("138"), false);
  });
});
