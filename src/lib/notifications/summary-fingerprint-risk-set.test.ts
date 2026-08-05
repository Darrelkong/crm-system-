import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCanonicalSummaryFingerprintPayload,
  buildSummaryFingerprint,
  hashSummaryFingerprintPayload,
} from "./summary-fingerprint";

const baseCounts = {
  totalCount: 2,
  tomorrowCount: 0,
  within7Count: 1,
  within14Count: 1,
  routineCount: 0,
  earliestReleaseAt: "2026-08-10T00:00:00.000Z",
};

const episodeA =
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1:11111111-1111-1111-1111-111111111102:2026-07-01T00:00:00.000Z:14:2026-01-01T00:00:00.000Z";
const episodeB =
  "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1:11111111-1111-1111-1111-111111111102:2026-07-02T00:00:00.000Z:14:2026-01-01T00:00:00.000Z";
const episodeC =
  "cccccccc-cccc-cccc-cccc-ccccccccccc1:11111111-1111-1111-1111-111111111102:2026-07-03T00:00:00.000Z:14:2026-01-01T00:00:00.000Z";
const episodeD =
  "dddddddd-dddd-dddd-dddd-ddddddddddd1:11111111-1111-1111-1111-111111111102:2026-07-04T00:00:00.000Z:14:2026-01-01T00:00:00.000Z";

const staffUser = "11111111-1111-1111-1111-111111111102";

describe("summary fingerprint risk set", () => {
  it("changes when risk customers are replaced but counts stay the same", () => {
    const before = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [episodeA, episodeB],
      counts: baseCounts,
    });
    const after = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [episodeC, episodeD],
      counts: baseCounts,
    });
    assert.notEqual(before, after);
  });

  it("is stable when only episode key order changes", () => {
    const forward = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [episodeA, episodeB],
      counts: baseCounts,
    });
    const reversed = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [episodeB, episodeA],
      counts: baseCounts,
    });
    assert.equal(forward, reversed);
  });

  it("changes when owner changes for the same customer", () => {
    const ownerA = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [episodeA],
      counts: { ...baseCounts, totalCount: 1 },
    });
    const ownerB = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1:22222222-2222-2222-2222-222222222203:2026-07-01T00:00:00.000Z:14:2026-01-01T00:00:00.000Z",
      ],
      counts: { ...baseCounts, totalCount: 1 },
    });
    assert.notEqual(ownerA, ownerB);
  });

  it("changes when cycle or rule episode changes", () => {
    const cycleA = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [episodeA],
      counts: { ...baseCounts, totalCount: 1 },
    });
    const cycleB = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1:11111111-1111-1111-1111-111111111102:2026-08-01T00:00:00.000Z:14:2026-01-01T00:00:00.000Z",
      ],
      counts: { ...baseCounts, totalCount: 1 },
    });
    const ruleB = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1:11111111-1111-1111-1111-111111111102:2026-07-01T00:00:00.000Z:60:2026-02-01T00:00:00.000Z",
      ],
      counts: { ...baseCounts, totalCount: 1 },
    });
    assert.notEqual(cycleA, cycleB);
    assert.notEqual(cycleA, ruleB);
  });

  it("changes when tomorrow count changes", () => {
    const before = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [episodeA],
      counts: { ...baseCounts, totalCount: 1, tomorrowCount: 0 },
    });
    const after = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [episodeA],
      counts: { ...baseCounts, totalCount: 1, tomorrowCount: 1 },
    });
    assert.notEqual(before, after);
  });

  it("changes when admin member set changes with same member count", () => {
    const teamA = buildSummaryFingerprint({
      summaryScope: "admin_team",
      recipientUserId: "11111111-1111-1111-1111-111111111101",
      riskEpisodeKeys: [episodeA, episodeB],
      counts: { ...baseCounts, memberCount: 2 },
    });
    const teamB = buildSummaryFingerprint({
      summaryScope: "admin_team",
      recipientUserId: "11111111-1111-1111-1111-111111111101",
      riskEpisodeKeys: [episodeA, episodeC],
      counts: { ...baseCounts, memberCount: 2 },
    });
    assert.notEqual(teamA, teamB);
  });

  it("returns a sha256 hash and does not embed episode keys in the hash input directly", () => {
    const fingerprint = buildSummaryFingerprint({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [episodeA],
      counts: { ...baseCounts, totalCount: 1 },
    });
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(fingerprint, /aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1/);
  });

  it("keeps canonical payload stable for shuffled query order", () => {
    const payloadA = buildCanonicalSummaryFingerprintPayload({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [episodeB, episodeA, episodeB],
      counts: baseCounts,
    });
    const payloadB = buildCanonicalSummaryFingerprintPayload({
      summaryScope: "staff_self",
      recipientUserId: staffUser,
      riskEpisodeKeys: [episodeA, episodeB],
      counts: baseCounts,
    });
    assert.equal(
      hashSummaryFingerprintPayload(payloadA),
      hashSummaryFingerprintPayload(payloadB),
    );
  });
});
