import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import {
  INGESTION_PROCESSING_LEASE_V1_MS,
  computeIngestionProcessingLease,
  getIngestionProcessingTrustNow,
  isLegacyUnleasedProcessing,
  isProcessingLeaseActive,
  isProcessingLeaseExpired,
  setIngestionProcessingLeaseTestClock,
} from "@/lib/mail/provider-ingestion-processing-lease";

describe("provider ingestion processing lease", () => {
  afterEach(() => {
    setIngestionProcessingLeaseTestClock(null);
  });

  it("V1 lease is 15 minutes", () => {
    assert.equal(INGESTION_PROCESSING_LEASE_V1_MS, 15 * 60 * 1000);
  });

  it("computes lease from trusted server time", () => {
    setIngestionProcessingLeaseTestClock("2026-08-21T10:00:00.000Z");
    const lease = computeIngestionProcessingLease();
    assert.equal(lease.processingStartedAt, "2026-08-21T10:00:00.000Z");
    assert.equal(lease.processingLeaseExpiresAt, "2026-08-21T10:15:00.000Z");
  });

  it("detects legacy unleased processing", () => {
    assert.ok(
      isLegacyUnleasedProcessing({
        status: "processing",
        processingStartedAt: null,
        processingLeaseExpiresAt: null,
      }),
    );
  });

  it("detects active vs expired lease", () => {
    const event = {
      processingStartedAt: "2026-08-21T10:00:00.000Z",
      processingLeaseExpiresAt: "2026-08-21T10:15:00.000Z",
    };
    assert.ok(
      isProcessingLeaseActive(event, "2026-08-21T10:14:59.999Z"),
    );
    assert.ok(isProcessingLeaseExpired(event, "2026-08-21T10:15:00.000Z"));
    assert.ok(!isProcessingLeaseExpired(event, "2026-08-21T10:14:59.999Z"));
  });

  it("uses injectable test clock for trust now", () => {
    setIngestionProcessingLeaseTestClock("2026-08-21T12:00:00.000Z");
    assert.equal(getIngestionProcessingTrustNow(), "2026-08-21T12:00:00.000Z");
  });
});
