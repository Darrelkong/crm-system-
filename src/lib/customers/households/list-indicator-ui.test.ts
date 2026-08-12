import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("customer family icon component", () => {
  it("uses subtle Users icon styling without decorative chrome", () => {
    const source = readFileSync(
      "src/components/customers/customer-family-icon.tsx",
      "utf8",
    );
    assert.match(source, /Users/);
    assert.match(source, /h-3\.5 w-3\.5/);
    assert.match(source, /shrink-0/);
    assert.match(source, /crm-text-muted/);
    assert.doesNotMatch(source, /rounded-full|shadow|animate|bg-/);
    assert.match(source, /aria-label=\{label\}/);
    assert.match(source, /aria-hidden="true"/);
  });
});

describe("customer list family icon placement", () => {
  it("renders icon before customer name on desktop and mobile without new column", () => {
    const client = readFileSync(
      "src/app/(dashboard)/customers/customers-list-client.tsx",
      "utf8",
    );
    assert.match(client, /CustomerFamilyIcon/);
    assert.match(client, /hasHouseholdIcon/);
    assert.match(client, /inline-flex min-w-0 items-center gap-1\.5/);
    assert.doesNotMatch(client, /familyCount|householdId|memberCount/);
    assert.match(client, /\{c\.hasHouseholdIcon && \(\s*<CustomerFamilyIcon/);
    assert.equal(
      (client.match(/\{c\.hasHouseholdIcon &&/g) ?? []).length,
      2,
    );
  });

  it("mapApiItem defaults undefined hasHouseholdIcon to false", () => {
    const client = readFileSync(
      "src/app/(dashboard)/customers/customers-list-client.tsx",
      "utf8",
    );
    assert.match(client, /hasHouseholdIcon: item\.hasHouseholdIcon \?\? false/);
  });
});
