import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildQuickEntryCanonicalSubmissionObject,
  hashQuickEntrySubmissionPayload,
  type QuickEntryCanonicalSubmissionPayload,
} from "@/lib/public-pool/quick-entry-submission-hash";

const basePayload: QuickEntryCanonicalSubmissionPayload = {
  submissionId: "550e8400-e29b-41d4-a716-446655440000",
  rows: [
    {
      clientRowId: "r1",
      customerName: "张三",
      phone: "13800138000",
      phoneCountryCode: "+86",
      wechatId: null,
      requestedProjectName: "加拿大移民项目",
      initialFollowUpNote: null,
      supplementalNote: null,
    },
  ],
};

describe("hashQuickEntrySubmissionPayload", () => {
  it("is deterministic and 64 hex chars", async () => {
    const a = await hashQuickEntrySubmissionPayload(basePayload);
    const b = await hashQuickEntrySubmissionPayload(basePayload);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it("ignores object property insertion order via canonical builder", async () => {
    const shuffled = {
      rows: basePayload.rows,
      submissionId: basePayload.submissionId,
    };
    const h1 = await hashQuickEntrySubmissionPayload(basePayload);
    const h2 = await hashQuickEntrySubmissionPayload(shuffled);
    assert.equal(h1, h2);

    const canonical = buildQuickEntryCanonicalSubmissionObject(basePayload);
    assert.deepEqual(Object.keys(canonical), ["submissionId", "rows"]);
    const row = (canonical.rows as Record<string, unknown>[])[0]!;
    assert.deepEqual(Object.keys(row), [
      "clientRowId",
      "customerName",
      "phone",
      "phoneCountryCode",
      "wechatId",
      "requestedProjectName",
      "initialFollowUpNote",
      "supplementalNote",
    ]);
  });

  it("changes when rows order or clientRowId or name changes", async () => {
    const h0 = await hashQuickEntrySubmissionPayload(basePayload);
    const twoRows: QuickEntryCanonicalSubmissionPayload = {
      submissionId: basePayload.submissionId,
      rows: [
        basePayload.rows[0]!,
        {
          ...basePayload.rows[0]!,
          clientRowId: "r2",
          phone: "13900139000",
        },
      ],
    };
    const reordered: QuickEntryCanonicalSubmissionPayload = {
      submissionId: basePayload.submissionId,
      rows: [twoRows.rows[1]!, twoRows.rows[0]!],
    };
    const hOrderA = await hashQuickEntrySubmissionPayload(twoRows);
    const hOrderB = await hashQuickEntrySubmissionPayload(reordered);
    assert.notEqual(hOrderA, hOrderB);

    const idChanged = await hashQuickEntrySubmissionPayload({
      ...basePayload,
      rows: [{ ...basePayload.rows[0]!, clientRowId: "r9" }],
    });
    assert.notEqual(idChanged, h0);

    const nameChanged = await hashQuickEntrySubmissionPayload({
      ...basePayload,
      rows: [{ ...basePayload.rows[0]!, customerName: "李四" }],
    });
    assert.notEqual(nameChanged, h0);
  });

  it("treats canonical null stably and does not embed actor/session/code", async () => {
    const withNulls = await hashQuickEntrySubmissionPayload(basePayload);
    const again = await hashQuickEntrySubmissionPayload({
      submissionId: basePayload.submissionId,
      rows: [
        {
          clientRowId: "r1",
          customerName: "张三",
          phone: "13800138000",
          phoneCountryCode: "+86",
          wechatId: null,
          requestedProjectName: "加拿大移民项目",
          initialFollowUpNote: null,
          supplementalNote: null,
        },
      ],
    });
    assert.equal(withNulls, again);

    const canonical = JSON.stringify(
      buildQuickEntryCanonicalSubmissionObject(basePayload),
    );
    assert.equal(canonical.includes("actorUserId"), false);
    assert.equal(canonical.includes("sessionId"), false);
    assert.equal(canonical.includes("grantVersion"), false);
    assert.equal(canonical.includes('"code"'), false);
  });
});
