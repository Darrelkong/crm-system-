import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("valid internal customer owner SQL", () => {
  it("requires active, non-deleted staff or admin owners", () => {
    const source = readFileSync(
      "src/lib/customers/valid-internal-customer-owner.ts",
      "utf8",
    );
    assert.match(source, /EXISTS/);
    assert.match(source, /is_active = 1/);
    assert.match(source, /deleted_at IS NULL/);
    assert.match(source, /role IN \('staff', 'admin'\)/);
    assert.match(source, /impossibleCustomerMatchSql/);
  });
});
