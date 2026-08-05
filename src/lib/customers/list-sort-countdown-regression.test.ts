import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildCustomerListOrderBy } from "@/lib/customers/list-sort";

describe("customer list sort regression with countdown", () => {
  it("keeps the existing pinned-then-follow-up order builder", () => {
    const orderBy = buildCustomerListOrderBy();
    assert.equal(orderBy.length, 6);
  });

  it("does not sort by reclamation countdown fields in list queries", () => {
    const queries = readFileSync("src/lib/customers/queries.ts", "utf8");
    const listSort = readFileSync("src/lib/customers/list-sort.ts", "utf8");
    const client = readFileSync(
      "src/app/(dashboard)/customers/customers-list-client.tsx",
      "utf8",
    );

    assert.doesNotMatch(queries, /reclamationCountdown|daysRemaining|riskBand/);
    assert.doesNotMatch(listSort, /reclamationCountdown|daysRemaining|grace/);
    assert.doesNotMatch(client, /sort\(.*reclamation|orderBy.*reclaim/i);
  });

  it("does not add fixed high-risk filter UI controls", () => {
    const client = readFileSync(
      "src/app/(dashboard)/customers/customers-list-client.tsx",
      "utf8",
    );
    assert.doesNotMatch(
      client,
      /reclamationRisk=|明日自动释放筛选|7 天内释放|高风险客户/,
    );
  });
});
