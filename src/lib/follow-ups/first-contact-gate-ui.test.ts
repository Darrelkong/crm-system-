import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const formSource = readFileSync(
  join(
    process.cwd(),
    "src/app/(dashboard)/customers/[id]/follow-ups/new/new-follow-up-form.tsx",
  ),
  "utf8",
);

const pageSource = readFileSync(
  join(
    process.cwd(),
    "src/app/(dashboard)/customers/[id]/follow-ups/new/page.tsx",
  ),
  "utf8",
);

describe("first contact follow-up gate UI wiring", () => {
  it("page evaluates gate server-side and passes props to form", () => {
    assert.match(pageSource, /evaluateFirstContactFollowUpGate/);
    assert.match(pageSource, /firstContactGateActive/);
  });

  it("form shows gate warning, disables submit, and links to work items", () => {
    assert.match(formSource, /firstContactGateActive/);
    assert.match(formSource, /followUps\.firstContactGateTitle/);
    assert.match(formSource, /followUps\.firstContactGateMessage/);
    assert.match(formSource, /followUps\.firstContactGateCta/);
    assert.match(formSource, /\/work-items\?tab=tasks&view=open/);
    assert.match(formSource, /disabled=\{submitting \|\| firstContactGateActive\}/);
    assert.match(formSource, /FIRST_CONTACT_REQUIRED/);
  });
});
