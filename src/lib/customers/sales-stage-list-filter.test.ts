import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isValidAdminOwnerListParam,
  isValidSalesStageListFilter,
  parseAdminOwnerListParam,
  parseSalesStageListParam,
} from "@/lib/customers/sales-stage-list-filter";
import { SEED_IDS } from "@/lib/constants/seed-ids";

describe("sales stage list filter params", () => {
  it("accepts catalog and not-set stages only", () => {
    assert.equal(parseSalesStageListParam("negotiation"), "negotiation");
    assert.equal(parseSalesStageListParam("negotiating"), "negotiating");
    assert.equal(parseSalesStageListParam("__not_set__"), "__not_set__");
    assert.equal(parseSalesStageListParam("invalid_stage"), undefined);
    assert.equal(parseSalesStageListParam("__other__"), undefined);
    assert.equal(isValidSalesStageListFilter("closed_won"), true);
  });

  it("validates admin owner ids", () => {
    assert.equal(parseAdminOwnerListParam(SEED_IDS.staffA), SEED_IDS.staffA);
    assert.equal(parseAdminOwnerListParam("not-a-uuid"), undefined);
    assert.equal(isValidAdminOwnerListParam("x"), false);
  });
});
