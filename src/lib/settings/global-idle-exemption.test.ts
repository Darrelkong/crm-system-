import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isoToUnixSeconds,
  isStaffSessionBlockedByReverifyEpoch,
  parseStaffAccessReverifyAfter,
  staffAccessJwtAllowsNewSession,
  evaluateStaffLoginAccessEpochGate,
} from "@/lib/settings/global-idle-exemption";
import {
  DEDICATED_ONLY_SETTING_KEYS,
  isDedicatedOnlySettingKey,
  isLockedSettingKey,
  SETTING_DEFAULTS,
  SETTING_KEYS,
} from "@/lib/settings/keys";
import { validateSettingValue } from "@/lib/settings/validation";
import { getEditableSettingKeys } from "@/lib/settings/settings-ui-sections";

describe("global idle exemption — setting defaults and keys", () => {
  it("global_idle_timeout_exempt_enabled defaults to false", () => {
    assert.equal(
      SETTING_DEFAULTS.global_idle_timeout_exempt_enabled,
      "false",
    );
    assert.equal(
      (SETTING_KEYS as readonly string[]).includes(
        "global_idle_timeout_exempt_enabled",
      ),
      true,
    );
  });

  it("staff_access_reverify_after is not a public SettingKey", () => {
    assert.equal(
      (SETTING_KEYS as readonly string[]).includes(
        "staff_access_reverify_after",
      ),
      false,
    );
  });

  it("global switch is dedicated-only and not in Admin UI editable keys", () => {
    assert.equal(
      isDedicatedOnlySettingKey("global_idle_timeout_exempt_enabled"),
      true,
    );
    assert.deepEqual([...DEDICATED_ONLY_SETTING_KEYS], [
      "global_idle_timeout_exempt_enabled",
    ]);
    assert.equal(
      getEditableSettingKeys().includes("global_idle_timeout_exempt_enabled"),
      false,
    );
  });

  it("inactivity_logout_minutes remains locked", () => {
    assert.equal(isLockedSettingKey("inactivity_logout_minutes"), true);
  });

  it("global switch only accepts true/false", () => {
    assert.equal(
      validateSettingValue("global_idle_timeout_exempt_enabled", "true"),
      null,
    );
    assert.equal(
      validateSettingValue("global_idle_timeout_exempt_enabled", "false"),
      null,
    );
    assert.ok(
      validateSettingValue("global_idle_timeout_exempt_enabled", "yes") !=
        null,
    );
    assert.ok(
      validateSettingValue("global_idle_timeout_exempt_enabled", "1") != null,
    );
  });
});

describe("parseStaffAccessReverifyAfter", () => {
  it("accepts canonical non-negative decimal unix-second strings", () => {
    assert.equal(parseStaffAccessReverifyAfter("0"), 0);
    assert.equal(parseStaffAccessReverifyAfter("1"), 1);
    assert.equal(parseStaffAccessReverifyAfter("1000"), 1000);
    assert.equal(parseStaffAccessReverifyAfter("1750000000"), 1750000000);
  });

  it("rejects empty, whitespace, signs, decimals, and text as 0", () => {
    assert.equal(parseStaffAccessReverifyAfter(undefined), 0);
    assert.equal(parseStaffAccessReverifyAfter(null), 0);
    assert.equal(parseStaffAccessReverifyAfter(""), 0);
    assert.equal(parseStaffAccessReverifyAfter(" "), 0);
    assert.equal(parseStaffAccessReverifyAfter("-1"), 0);
    assert.equal(parseStaffAccessReverifyAfter("+1"), 0);
    assert.equal(parseStaffAccessReverifyAfter("1.5"), 0);
    assert.equal(parseStaffAccessReverifyAfter("abc"), 0);
    assert.equal(parseStaffAccessReverifyAfter("1000abc"), 0);
    assert.equal(parseStaffAccessReverifyAfter("abc1000"), 0);
    assert.equal(parseStaffAccessReverifyAfter("Infinity"), 0);
    assert.equal(parseStaffAccessReverifyAfter("NaN"), 0);
  });

  it("rejects scientific notation, hex, leading zeros, and ISO as 0", () => {
    assert.equal(parseStaffAccessReverifyAfter("1e3"), 0);
    assert.equal(parseStaffAccessReverifyAfter("1E3"), 0);
    assert.equal(parseStaffAccessReverifyAfter("0x10"), 0);
    assert.equal(parseStaffAccessReverifyAfter("01"), 0);
    assert.equal(parseStaffAccessReverifyAfter("001000"), 0);
    assert.equal(parseStaffAccessReverifyAfter("2026-07-20T00:00:00Z"), 0);
    assert.equal(parseStaffAccessReverifyAfter("2026-07-20T00:00:00.000Z"), 0);
  });

  it("rejects values above Number.MAX_SAFE_INTEGER as 0", () => {
    assert.equal(parseStaffAccessReverifyAfter("9007199254740992"), 0);
  });
});

describe("isStaffSessionBlockedByReverifyEpoch", () => {
  const epoch = 1_700_000_000;
  const beforeIso = new Date((epoch - 10) * 1000).toISOString();
  const equalIso = new Date(epoch * 1000).toISOString();
  const afterIso = new Date((epoch + 10) * 1000).toISOString();

  it("never blocks admin", () => {
    assert.equal(
      isStaffSessionBlockedByReverifyEpoch("admin", beforeIso, epoch),
      false,
    );
  });

  it("blocks staff when createdAt is before or equal to epoch", () => {
    assert.equal(
      isStaffSessionBlockedByReverifyEpoch("staff", beforeIso, epoch),
      true,
    );
    assert.equal(
      isStaffSessionBlockedByReverifyEpoch("staff", equalIso, epoch),
      true,
    );
  });

  it("allows staff when createdAt is after epoch", () => {
    assert.equal(
      isStaffSessionBlockedByReverifyEpoch("staff", afterIso, epoch),
      false,
    );
  });

  it("epoch 0 never blocks", () => {
    assert.equal(
      isStaffSessionBlockedByReverifyEpoch("staff", beforeIso, 0),
      false,
    );
  });

  it("fail-closed when session createdAt cannot be parsed", () => {
    assert.equal(
      isStaffSessionBlockedByReverifyEpoch("staff", "not-a-date", epoch),
      true,
    );
  });
});

describe("isoToUnixSeconds", () => {
  it("converts ISO to floor unix seconds", () => {
    assert.equal(isoToUnixSeconds("1970-01-01T00:00:01.999Z"), 1);
  });

  it("returns null for invalid ISO", () => {
    assert.equal(isoToUnixSeconds("nope"), null);
  });
});

describe("staffAccessJwtAllowsNewSession", () => {
  it("epoch 0 allows staff even without iat", () => {
    assert.equal(
      staffAccessJwtAllowsNewSession({
        role: "staff",
        accessCheckRequired: true,
        accessIat: null,
        reverifyAfterUnixSec: 0,
      }),
      true,
    );
  });

  it("allows admin even when iat is before epoch", () => {
    assert.equal(
      staffAccessJwtAllowsNewSession({
        role: "admin",
        accessCheckRequired: true,
        accessIat: 1,
        reverifyAfterUnixSec: 100,
      }),
      true,
    );
  });

  it("allows staff when iat > epoch", () => {
    assert.equal(
      staffAccessJwtAllowsNewSession({
        role: "staff",
        accessCheckRequired: true,
        accessIat: 101,
        reverifyAfterUnixSec: 100,
      }),
      true,
    );
  });

  it("rejects staff when iat equals epoch", () => {
    assert.equal(
      staffAccessJwtAllowsNewSession({
        role: "staff",
        accessCheckRequired: true,
        accessIat: 100,
        reverifyAfterUnixSec: 100,
      }),
      false,
    );
  });

  it("rejects staff when iat is before epoch", () => {
    assert.equal(
      staffAccessJwtAllowsNewSession({
        role: "staff",
        accessCheckRequired: true,
        accessIat: 99,
        reverifyAfterUnixSec: 100,
      }),
      false,
    );
  });

  it("rejects staff when iat is missing", () => {
    assert.equal(
      staffAccessJwtAllowsNewSession({
        role: "staff",
        accessCheckRequired: true,
        accessIat: null,
        reverifyAfterUnixSec: 100,
      }),
      false,
    );
    assert.equal(
      staffAccessJwtAllowsNewSession({
        role: "staff",
        accessCheckRequired: true,
        accessIat: undefined,
        reverifyAfterUnixSec: 100,
      }),
      false,
    );
  });

  it("rejects staff when iat is a string at runtime", () => {
    assert.equal(
      staffAccessJwtAllowsNewSession({
        role: "staff",
        accessCheckRequired: true,
        accessIat: "101" as unknown as number,
        reverifyAfterUnixSec: 100,
      }),
      false,
    );
  });

  it("rejects staff when iat is a float", () => {
    assert.equal(
      staffAccessJwtAllowsNewSession({
        role: "staff",
        accessCheckRequired: true,
        accessIat: 100.5,
        reverifyAfterUnixSec: 100,
      }),
      false,
    );
  });

  it("rejects staff when iat is negative", () => {
    assert.equal(
      staffAccessJwtAllowsNewSession({
        role: "staff",
        accessCheckRequired: true,
        accessIat: -1,
        reverifyAfterUnixSec: 100,
      }),
      false,
    );
  });

  it("rejects staff when iat exceeds MAX_SAFE_INTEGER", () => {
    assert.equal(
      staffAccessJwtAllowsNewSession({
        role: "staff",
        accessCheckRequired: true,
        accessIat: Number.MAX_SAFE_INTEGER + 1,
        reverifyAfterUnixSec: 100,
      }),
      false,
    );
  });

  it("skips iat gate when Access check is not required (dev/test)", () => {
    assert.equal(
      staffAccessJwtAllowsNewSession({
        role: "staff",
        accessCheckRequired: false,
        accessIat: null,
        reverifyAfterUnixSec: 100,
      }),
      true,
    );
  });
});

describe("evaluateStaffLoginAccessEpochGate", () => {
  it("returns SESSION_ACCESS_REVERIFY_REQUIRED for denied staff", () => {
    const decision = evaluateStaffLoginAccessEpochGate({
      role: "staff",
      accessCheckRequired: true,
      accessIat: 50,
      reverifyAfterUnixSec: 100,
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.errorCode, "SESSION_ACCESS_REVERIFY_REQUIRED");
    }
  });

  it("allows when Access check is skipped even with active epoch", () => {
    const decision = evaluateStaffLoginAccessEpochGate({
      role: "staff",
      accessCheckRequired: false,
      accessIat: null,
      reverifyAfterUnixSec: 100,
    });
    assert.equal(decision.allowed, true);
  });
});
