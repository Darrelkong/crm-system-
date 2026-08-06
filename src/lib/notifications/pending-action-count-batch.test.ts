import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getPendingActionCount,
  getPendingActionCountsByUserIds,
  pendingActionCountWhere,
} from "@/lib/notifications/queries";

describe("pending action count batch helpers", () => {
  it("exports shared pending where helper for batch counts", () => {
    const where = pendingActionCountWhere("user-1");
    assert.ok(where);
    assert.equal(typeof getPendingActionCount, "function");
    assert.equal(typeof getPendingActionCountsByUserIds, "function");
  });

  it("documents batch API shape for admin team overview", () => {
    assert.equal(typeof getPendingActionCount, "function");
    assert.equal(typeof getPendingActionCountsByUserIds, "function");
  });
});
