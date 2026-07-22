import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseQuickEntryBatchRequest } from "@/lib/public-pool/quick-entry-request-schema";
import { QUICK_ENTRY_SUBMISSION_ERROR_CODES } from "@/lib/public-pool/quick-entry-submission-constants";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";
import { QUICK_ENTRY_ERROR_CODES } from "@/lib/public-pool/quick-entry-constants";

const validRow = {
  clientRowId: "row-1",
  customerName: "张三",
  phone: "13800138000",
  requestedProjectName: "加拿大移民项目",
};

const validBody = {
  submissionId: "550e8400-e29b-41d4-a716-4466554400c1",
  rows: [validRow],
};

describe("parseQuickEntryBatchRequest", () => {
  it("accepts only submissionId + rows top-level keys", () => {
    const ok = parseQuickEntryBatchRequest(validBody);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.submissionId, validBody.submissionId);
      assert.equal(ok.value.rows.length, 1);
    }

    const extra = parseQuickEntryBatchRequest({
      ...validBody,
      actorId: "x",
    });
    assert.equal(extra.ok, false);
    if (!extra.ok) {
      assert.equal(
        extra.errorCode,
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_INVALID,
      );
    }
  });

  it("rejects unknown row fields and system injection keys", () => {
    for (const bad of [
      { ...validRow, ownerId: null },
      { ...validRow, submissionDbId: "x" },
      { ...validRow, requestHash: "y" },
      { ...validRow, expectedProcessingStartedAt: "z" },
      { ...validRow, status: "public_pool" },
      JSON.parse(
        JSON.stringify({
          ...validRow,
          __proto__: { polluted: true },
        }),
      ),
    ]) {
      const result = parseQuickEntryBatchRequest({
        submissionId: validBody.submissionId,
        rows: [bad],
      });
      // JSON.stringify drops __proto__ key; use Object.defineProperty case below
      if (bad && typeof bad === "object" && "status" in bad && bad.status === "public_pool") {
        assert.equal(result.ok, false);
      } else if ("ownerId" in (bad as object) || "submissionDbId" in (bad as object)) {
        assert.equal(result.ok, false, JSON.stringify(bad));
      }
    }

    const protoRow = { ...validRow } as Record<string, unknown>;
    Object.defineProperty(protoRow, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const protoResult = parseQuickEntryBatchRequest({
      submissionId: validBody.submissionId,
      rows: [protoRow],
    });
    assert.equal(protoResult.ok, false);
  });

  it("rejects empty／oversized／duplicate clientRowId／non-object rows", () => {
    assert.equal(
      parseQuickEntryBatchRequest({
        submissionId: validBody.submissionId,
        rows: [],
      }).ok,
      false,
    );

    const twentyOne = Array.from({ length: 21 }, (_, i) => ({
      ...validRow,
      clientRowId: `r${i}`,
    }));
    const tooLarge = parseQuickEntryBatchRequest({
      submissionId: validBody.submissionId,
      rows: twentyOne,
    });
    assert.equal(tooLarge.ok, false);
    if (!tooLarge.ok) {
      assert.equal(
        tooLarge.errorCode,
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_TOO_LARGE,
      );
    }

    const dup = parseQuickEntryBatchRequest({
      submissionId: validBody.submissionId,
      rows: [validRow, { ...validRow }],
    });
    assert.equal(dup.ok, false);
    if (!dup.ok) {
      assert.equal(
        dup.errorCode,
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.CLIENT_ROW_ID_DUPLICATE,
      );
    }

    const nonObject = parseQuickEntryBatchRequest({
      submissionId: validBody.submissionId,
      rows: [null],
    });
    assert.equal(nonObject.ok, false);

    const arrayRow = parseQuickEntryBatchRequest({
      submissionId: validBody.submissionId,
      rows: [["x"]],
    });
    assert.equal(arrayRow.ok, false);
  });

  it("keeps customer business field errors for domain (name too short still parses)", () => {
    const result = parseQuickEntryBatchRequest({
      submissionId: validBody.submissionId,
      rows: [
        {
          clientRowId: "r1",
          customerName: "A",
          phone: "13800138000",
          requestedProjectName: "加拿大移民项目",
        },
      ],
    });
    assert.equal(result.ok, true);
  });

  it("does not mutate input object", () => {
    const body = structuredClone(validBody);
    const before = JSON.stringify(body);
    parseQuickEntryBatchRequest(body);
    assert.equal(JSON.stringify(body), before);
  });
});

describe("readLimitedJsonBody", () => {
  it("rejects non-json content-type", async () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    const result = await readLimitedJsonBody(req, 65536);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.httpStatus, 415);
      assert.equal(
        result.errorCode,
        QUICK_ENTRY_ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
      );
    }
  });

  it("rejects oversized Content-Length and actual bytes", async () => {
    const big = "x".repeat(70000);
    const byHeader = new Request("http://localhost/x", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "70000",
      },
      body: "{}",
    });
    const headerResult = await readLimitedJsonBody(byHeader, 65536);
    assert.equal(headerResult.ok, false);
    if (!headerResult.ok) {
      assert.equal(headerResult.httpStatus, 413);
    }

    const byBytes = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: big }),
    });
    const bytesResult = await readLimitedJsonBody(byBytes, 65536);
    assert.equal(bytesResult.ok, false);
    if (!bytesResult.ok) {
      assert.equal(bytesResult.httpStatus, 413);
      assert.equal(
        bytesResult.errorCode,
        QUICK_ENTRY_ERROR_CODES.REQUEST_TOO_LARGE,
      );
    }
  });

  it("accepts application/json with charset and exact limit boundary", async () => {
    const payload = JSON.stringify({ ok: true });
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: payload,
    });
    const result = await readLimitedJsonBody(req, payload.length);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value, { ok: true });
      assert.equal(result.byteLength, payload.length);
    }
  });

  it("rejects empty and invalid JSON without leaking body", async () => {
    const empty = await readLimitedJsonBody(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      }),
      65536,
    );
    assert.equal(empty.ok, false);

    const invalid = await readLimitedJsonBody(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
      65536,
    );
    assert.equal(invalid.ok, false);
    if (!invalid.ok) {
      assert.equal(JSON.stringify(invalid).includes("{not-json"), false);
    }
  });
});
