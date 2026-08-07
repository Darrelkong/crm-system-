import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("customer list sort control UX", () => {
  const source = readFileSync(
    "src/components/customers/customer-list-sort-control.tsx",
    "utf8",
  );

  it("uses accessible segmented button semantics", () => {
    assert.match(source, /role="group"/);
    assert.match(source, /aria-pressed=\{selected\}/);
    assert.match(source, /aria-label=\{t\("customers\.sortModeLabel"\)\}/);
    assert.match(source, /focus-visible:ring/);
    assert.match(source, /min-h-11/);
    assert.match(source, /grid-cols-2/);
  });

  it("shows helper text only for reclaim_soonest", () => {
    assert.match(source, /sortMode === "reclaim_soonest"/);
    assert.match(source, /customers\.sortModeReclaimHelper/);
  });
});
