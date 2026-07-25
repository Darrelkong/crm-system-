import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWatermarkIdentityLine,
  fitWatermarkDesktopFirstLine,
  fitWatermarkIdentity,
  resolveWatermarkDisplayName,
  truncateIdentity,
} from "./watermark-identity";
import { watermarkOffsetFromSeed } from "./watermark-offset";
import {
  createWatermarkClock,
  parseSystemTimePayload,
} from "./watermark-time";

describe("watermarkOffsetFromSeed", () => {
  it("returns stable offsets in the documented ranges", () => {
    const a = watermarkOffsetFromSeed("user-abc-123");
    const b = watermarkOffsetFromSeed("user-abc-123");
    assert.deepEqual(a, b);
    assert.ok(a.offsetX >= 0 && a.offsetX <= 40);
    assert.ok(a.offsetY >= 0 && a.offsetY <= 30);
  });

  it("varies by seed", () => {
    const a = watermarkOffsetFromSeed("user-a");
    const b = watermarkOffsetFromSeed("user-b");
    assert.notDeepEqual(a, b);
  });
});

describe("watermark identity helpers", () => {
  it("falls back to email when display name is missing", () => {
    assert.equal(
      resolveWatermarkDisplayName("", "a@example.com"),
      "a@example.com",
    );
    assert.equal(
      resolveWatermarkDisplayName(null, "a@example.com"),
      "a@example.com",
    );
    assert.equal(
      resolveWatermarkDisplayName(undefined, "a@example.com"),
      "a@example.com",
    );
    assert.equal(
      buildWatermarkIdentityLine("  ", "a@example.com"),
      "a@example.com",
    );
  });

  it("does not duplicate identical name and email", () => {
    assert.equal(
      buildWatermarkIdentityLine("a@example.com", "a@example.com"),
      "a@example.com",
    );
  });

  it("joins name and email", () => {
    assert.equal(
      buildWatermarkIdentityLine("Ada", "ada@example.com"),
      "Ada · ada@example.com",
    );
  });

  it("handles empty email without throwing", () => {
    assert.equal(buildWatermarkIdentityLine("Ada", ""), "Ada · —");
    assert.equal(buildWatermarkIdentityLine("", ""), "—");
  });

  it("shrinks or truncates long identity text", () => {
    const long = `Very Long Name · ${"x".repeat(80)}@example.com`;
    const fitted = fitWatermarkIdentity(long, 200, 13, 9);
    assert.ok(fitted.fontSize <= 13);
    assert.ok(fitted.text.length < long.length || fitted.fontSize < 13);
  });

  it("keeps email domain when truncating long local parts", () => {
    const email = `${"verylonglocalpart".repeat(6)}@company.example.com`;
    const truncated = truncateIdentity(email, 28);
    assert.match(truncated, /@company\.example\.com$/);
    assert.ok(truncated.includes("…"));
    assert.ok(truncated.length <= 28);
  });

  it("keeps short desktop emails readable by shrinking before truncating", () => {
    const fitted = fitWatermarkDesktopFirstLine(
      "系统管理员 · admin@crm.local",
      "2026-07-25 19:08:18 HKT",
      290,
      13.5,
      9.5,
    );
    assert.match(fitted.identityText, /admin@crm\.local/);
    assert.ok(fitted.fontSize <= 13.5);
  });
});

describe("createWatermarkClock", () => {
  it("advances from calibrated server baseline using performance delta", () => {
    const clock = createWatermarkClock(1_000_000);
    const before = clock.nowMs();
    clock.calibrate(2_000_000);
    const after = clock.nowMs();
    assert.ok(after >= 2_000_000);
    assert.ok(before >= 1_000_000);
  });

  it("ignores invalid calibration and keeps the previous baseline", () => {
    const clock = createWatermarkClock(5_000_000);
    const before = clock.nowMs();
    clock.calibrate(Number.NaN);
    clock.calibrate(-1);
    clock.calibrate(0);
    const after = clock.nowMs();
    assert.ok(after >= before - 5);
    assert.ok(after < 5_000_000 + 60_000);
  });
});

describe("parseSystemTimePayload", () => {
  it("accepts finite positive now values", () => {
    assert.equal(parseSystemTimePayload({ now: 1_700_000_000_000 }), 1_700_000_000_000);
  });

  it("rejects invalid API payloads without throwing", () => {
    assert.equal(parseSystemTimePayload(null), null);
    assert.equal(parseSystemTimePayload({}), null);
    assert.equal(parseSystemTimePayload({ now: "1700" }), null);
    assert.equal(parseSystemTimePayload({ now: Number.NaN }), null);
    assert.equal(parseSystemTimePayload({ now: 0 }), null);
    assert.equal(parseSystemTimePayload({ now: -5 }), null);
  });
});
