import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSeedSelfExclusionAddresses } from "@/lib/mail/compose-draft-seed-service";

describe("resolveSeedSelfExclusionAddresses", () => {
  it("excludes only the resolved From identity", () => {
    assert.deepEqual(
      resolveSeedSelfExclusionAddresses({ address: "daniel@echfronthk.com" }),
      ["daniel@echfronthk.com"],
    );
  });

  it("excludes nothing when From is ambiguous", () => {
    assert.deepEqual(resolveSeedSelfExclusionAddresses(null), []);
  });
});
