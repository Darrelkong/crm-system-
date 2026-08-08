import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTeamReclamationHref,
  buildTeamValidFollowUpsHref,
  buildValidFollowUpsTodayHref,
  getDashboardHongKongTodayYmd,
} from "./dashboard-drilldown-links";
import { parseFollowUpListFilters } from "@/lib/follow-ups/list-filters";

const FIXED_NOW = new Date("2026-08-08T04:00:00.000Z");

describe("dashboard drill-down links", () => {
  it("builds HK today valid follow-up href without staff scope", () => {
    const href = buildValidFollowUpsTodayHref(FIXED_NOW);
    assert.equal(href, "/follow-ups?from=2026-08-08&to=2026-08-08&valid=1");
    const parsed = parseFollowUpListFilters(new URLSearchParams(href.split("?")[1]));
    assert.equal(parsed.validOnly, true);
    assert.equal(parsed.fromDate, "2026-08-08");
    assert.equal(parsed.toDate, getDashboardHongKongTodayYmd(FIXED_NOW));
    assert.equal(parsed.staffUserId, "");
  });

  it("builds team valid follow-up href with staff and period bounds", () => {
    const staffId = "11111111-1111-1111-1111-111111111102";
    const href7 = buildTeamValidFollowUpsHref(staffId, 7, FIXED_NOW);
    const href30 = buildTeamValidFollowUpsHref(staffId, 30, FIXED_NOW);
    assert.notEqual(href7, href30);

    const parsed7 = parseFollowUpListFilters(
      new URLSearchParams(href7.split("?")[1]),
    );
    assert.equal(parsed7.staffUserId, staffId);
    assert.equal(parsed7.validOnly, true);
    assert.equal(parsed7.fromDate, "2026-08-02");
    assert.equal(parsed7.toDate, "2026-08-08");

    const parsed30 = parseFollowUpListFilters(
      new URLSearchParams(href30.split("?")[1]),
    );
    assert.equal(parsed30.fromDate, "2026-07-10");
    assert.equal(parsed30.toDate, "2026-08-08");
  });

  it("builds team reclamation href with owner and team scope", () => {
    const ownerId = "11111111-1111-1111-1111-111111111102";
    assert.equal(
      buildTeamReclamationHref(ownerId),
      `/customers?ownerId=${ownerId}&reclamationRisk=team`,
    );
  });
});
