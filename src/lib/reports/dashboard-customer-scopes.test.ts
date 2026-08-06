import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sortTeamMembersStable } from "./admin-team-execution";

describe("dashboard customer scopes and team ordering", () => {
  it("sorts team members by display name, then email, then id", () => {
    const members = sortTeamMembersStable([
      {
        id: "b-id",
        displayName: "Alex",
        email: "b@example.com",
      },
      {
        id: "a-id",
        displayName: "Alex",
        email: "a@example.com",
      },
      {
        id: "c-id",
        displayName: "Beta",
        email: "z@example.com",
      },
    ]);

    assert.deepEqual(
      members.map((member) => member.id),
      ["a-id", "b-id", "c-id"],
    );
  });

  it("admin stage distribution requires a valid internal owner", () => {
    const scopes = readFileSync(
      "src/lib/reports/dashboard-customer-scopes.ts",
      "utf8",
    );
    assert.match(scopes, /adminStageDistributionWhere/);
    assert.match(scopes, /validInternalCustomerOwnerExistsSql/);
    assert.match(
      scopes,
      /adminStageDistributionWhere\(\)[\s\S]*validInternalCustomerOwnerExistsSql/,
    );
  });
});
