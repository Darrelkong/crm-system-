import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatNotificationBadgeCount } from "./badge-count";

describe("formatNotificationBadgeCount", () => {
  it("returns null for zero", () => {
    assert.equal(formatNotificationBadgeCount(0), null);
  });

  it("returns null for negative values", () => {
    assert.equal(formatNotificationBadgeCount(-1), null);
  });

  it("returns 1 for single unread", () => {
    assert.equal(formatNotificationBadgeCount(1), "1");
  });

  it("returns 10 for double-digit count", () => {
    assert.equal(formatNotificationBadgeCount(10), "10");
  });

  it("returns 99+ for large counts", () => {
    assert.equal(formatNotificationBadgeCount(100), "99+");
    assert.equal(formatNotificationBadgeCount(999), "99+");
  });
});
