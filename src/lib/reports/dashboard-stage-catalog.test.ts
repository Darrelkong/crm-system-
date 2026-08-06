import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateRawStageCounts,
  bucketRawSalesStage,
  buildStageDistributionRows,
  computeStagePercentage,
  getStageDistributionCatalog,
  STAGE_DIST_NOT_SET,
  STAGE_DIST_OTHER,
} from "./dashboard-stage-catalog";

describe("dashboard stage catalog", () => {
  it("keeps business order instead of count order", () => {
    const catalog = getStageDistributionCatalog();
    assert.equal(catalog[0]?.key, "new_lead");
    assert.equal(catalog[1]?.key, "contacted");
    assert.ok(catalog.findIndex((c) => c.key === "closed_won") > 0);
    assert.ok(
      catalog.findIndex((c) => c.key === STAGE_DIST_NOT_SET) >
        catalog.findIndex((c) => c.key === "paid"),
    );
  });

  it("buckets empty and unknown stages safely", () => {
    assert.equal(bucketRawSalesStage(""), STAGE_DIST_NOT_SET);
    assert.equal(bucketRawSalesStage("   "), STAGE_DIST_NOT_SET);
    assert.equal(bucketRawSalesStage("negotiation"), "negotiation");
    assert.equal(bucketRawSalesStage("negotiating"), "negotiating");
    assert.equal(bucketRawSalesStage("custom_legacy"), STAGE_DIST_OTHER);
  });

  it("builds rows with stable percentages and no NaN when total is zero", () => {
    const { countsByBucket, totalCustomers } = aggregateRawStageCounts([
      { stage: "negotiation", count: 2 },
      { stage: "custom", count: 1 },
    ]);
    assert.equal(totalCustomers, 3);
    const rows = buildStageDistributionRows({
      countsByBucket,
      totalCustomers,
    });
    const negotiation = rows.find((row) => row.key === "negotiation");
    assert.equal(negotiation?.count, 2);
    assert.equal(negotiation?.percentage, 66.7);
    const other = rows.find((row) => row.key === STAGE_DIST_OTHER);
    assert.equal(other?.count, 1);

    const emptyRows = buildStageDistributionRows({
      countsByBucket: new Map(),
      totalCustomers: 0,
    });
    assert.ok(emptyRows.every((row) => row.percentage === 0));
    assert.equal(computeStagePercentage(0, 0), 0);
  });

  it("sums bucket counts to total", () => {
    const { countsByBucket, totalCustomers } = aggregateRawStageCounts([
      { stage: "new_lead", count: 4 },
      { stage: "closed_won", count: 1 },
      { stage: "", count: 1 },
    ]);
    const sum = [...countsByBucket.values()].reduce((a, b) => a + b, 0);
    assert.equal(sum, totalCustomers);
  });
});
