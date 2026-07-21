import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRandomClaimAttemptOrder,
  secureRandomIndex,
  shuffleRandomClaimCandidates,
  UINT32_RANGE,
  type RandomIndexSource,
} from "@/lib/public-pool/random-claim";
import { RANDOM_CLAIM_CANDIDATE_BATCH_SIZE } from "@/lib/public-pool/constants";
import type { RandomClaimCandidate } from "@/lib/public-pool/queries";

function sequenceSource(values: number[]): RandomIndexSource {
  let i = 0;
  return (upperExclusive) => {
    const next = values[i];
    i += 1;
    assert.ok(
      next !== undefined,
      `sequenceSource exhausted at call ${i} (upper=${upperExclusive})`,
    );
    assert.ok(
      next >= 0 && next < upperExclusive,
      `sequence value ${next} out of range for upper=${upperExclusive}`,
    );
    return next;
  };
}

describe("secureRandomIndex", () => {
  it("returns 0 when upperExclusive is 1", () => {
    assert.equal(secureRandomIndex(1), 0);
  });

  it("rejects non-positive and non-integer upperExclusive", () => {
    assert.throws(() => secureRandomIndex(0), RangeError);
    assert.throws(() => secureRandomIndex(-1), RangeError);
    assert.throws(() => secureRandomIndex(1.5), RangeError);
    assert.throws(() => secureRandomIndex(Number.NaN), RangeError);
    assert.throws(() => secureRandomIndex(Number.POSITIVE_INFINITY), RangeError);
  });

  it("rejects upperExclusive greater than 2^32", () => {
    assert.throws(() => secureRandomIndex(UINT32_RANGE + 1), RangeError);
  });

  it("accepts upperExclusive === 2^32 without looping", () => {
    const viaSource = secureRandomIndex(UINT32_RANGE, () => UINT32_RANGE - 1);
    assert.equal(viaSource, UINT32_RANGE - 1);

    for (let i = 0; i < 5; i += 1) {
      const index = secureRandomIndex(UINT32_RANGE);
      assert.ok(Number.isInteger(index));
      assert.ok(index >= 0 && index < UINT32_RANGE);
    }
  });

  it("uses injected randomSource and rejects out-of-range results", () => {
    assert.equal(secureRandomIndex(5, () => 3), 3);
    assert.throws(() => secureRandomIndex(5, () => 5), RangeError);
    assert.throws(() => secureRandomIndex(5, () => -1), RangeError);
  });

  it("retries after rejection sampling rejects a value", () => {
    const original = crypto.getRandomValues.bind(crypto);
    let calls = 0;
    // upperExclusive=3 → UINT32_RANGE % 3 = 1 → limit = 2^32 - 1
    // Reject first sample (== limit), accept second.
    crypto.getRandomValues = ((arr: Uint32Array) => {
      calls += 1;
      arr[0] = calls === 1 ? UINT32_RANGE - 1 : 4;
      return arr;
    }) as typeof crypto.getRandomValues;

    try {
      const index = secureRandomIndex(3);
      assert.equal(calls, 2);
      assert.equal(index, 4 % 3);
      assert.ok(index < 3);
    } finally {
      crypto.getRandomValues = original;
    }
  });

  it("production path stays within bounds", () => {
    for (let i = 0; i < 40; i += 1) {
      const index = secureRandomIndex(7);
      assert.ok(index >= 0 && index < 7);
    }
  });
});

describe("shuffleRandomClaimCandidates", () => {
  it("handles empty and single-item arrays", () => {
    assert.deepEqual(shuffleRandomClaimCandidates([]), []);
    const one = [{ id: "a" }];
    const shuffled = shuffleRandomClaimCandidates(one);
    assert.deepEqual(shuffled, [{ id: "a" }]);
    assert.notEqual(shuffled, one);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b", "c"];
    const copy = input.slice();
    shuffleRandomClaimCandidates(input, sequenceSource([0, 0]));
    assert.deepEqual(input, copy);
  });

  it("preserves elements without duplicates or omissions", () => {
    const input = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const shuffled = shuffleRandomClaimCandidates(
      input,
      sequenceSource([0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
    assert.equal(shuffled.length, 10);
    assert.deepEqual([...shuffled].sort(), [...input].sort());
  });

  it("produces a fixed order with a fixed random source", () => {
    // Fisher–Yates from the end with j always 0:
    // [a,b,c,d] → [d,b,c,a] → [c,b,d,a] → [b,c,d,a]
    const input = ["a", "b", "c", "d"];
    const shuffled = shuffleRandomClaimCandidates(
      input,
      sequenceSource([0, 0, 0]),
    );
    assert.deepEqual(shuffled, ["b", "c", "d", "a"]);
  });

  it("createRandomClaimAttemptOrder matches shuffle", () => {
    const input = [1, 2, 3];
    const source = sequenceSource([1, 0]);
    const a = shuffleRandomClaimCandidates(input, source);
    const source2 = sequenceSource([1, 0]);
    const b = createRandomClaimAttemptOrder(input, source2);
    assert.deepEqual(a, b);
  });

  it("candidate DTO shape has no PII fields", () => {
    const candidates: RandomClaimCandidate[] = [
      {
        id: "id-1",
        poolEnteredAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        releasedBy: null,
      },
    ];
    const shuffled = shuffleRandomClaimCandidates(candidates);
    const keys = Object.keys(shuffled[0]!).sort();
    assert.deepEqual(keys, [
      "createdAt",
      "id",
      "poolEnteredAt",
      "releasedBy",
    ]);
    assert.equal("phone" in shuffled[0]!, false);
    assert.equal("email" in shuffled[0]!, false);
    assert.equal("wechatId" in shuffled[0]!, false);
    assert.equal("notes" in shuffled[0]!, false);
  });

  it("batch size constant remains fixed at 10", () => {
    assert.equal(RANDOM_CLAIM_CANDIDATE_BATCH_SIZE, 10);
  });
});
