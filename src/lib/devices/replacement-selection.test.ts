import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDeviceDisplayLabel, getDeviceNetworkAddress } from "@/lib/devices/display";
import { sortReplacementCandidates } from "@/lib/devices/replacement-selection";
import type { DeviceListItem } from "@/lib/devices/types";

function device(
  id: string,
  values: Partial<DeviceListItem> = {},
): DeviceListItem {
  return {
    id,
    user_id: "staff-1",
    user_display_name: "Staff",
    user_email: "staff@example.com",
    device_id_hash: `${id}-hash`,
    device_name: id,
    user_agent: null,
    user_agent_summary: id,
    ip_address: null,
    status: "approved",
    approved_by: "admin-1",
    approved_by_name: "Admin",
    approved_at: "2026-08-01T00:00:00.000Z",
    revoked_at: null,
    last_seen_at: null,
    last_seen_ip: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...values,
  };
}

describe("approve-and-replace default selection", () => {
  it("keeps pending-card and modal metadata tied to the pending device", () => {
    const pending = device("pending", {
      device_name: "Chrome · iOS 新设备",
      user_agent_summary: "Safari · iOS",
      last_seen_ip: "203.0.113.40",
      ip_address: "203.0.113.41",
      status: "pending",
    });
    const replacement = device("replacement", {
      device_name: "Safari · iOS",
      last_seen_at: "2026-08-16T10:00:00.000Z",
    });

    const modalState = {
      pendingDevice: pending,
      selectedReplacementId: replacement.id,
    };
    assert.equal(getDeviceDisplayLabel(pending), "Chrome · iOS 新设备");
    assert.equal(getDeviceDisplayLabel(modalState.pendingDevice), "Chrome · iOS 新设备");
    assert.equal(getDeviceNetworkAddress(pending), "203.0.113.40");

    modalState.selectedReplacementId = "another-replacement";
    assert.equal(
      getDeviceDisplayLabel(modalState.pendingDevice),
      "Chrome · iOS 新设备",
    );
    assert.equal(getDeviceDisplayLabel(replacement), "Safari · iOS");
  });

  it("selects the least recently used device first", () => {
    const result = sortReplacementCandidates([
      device("recent", { last_seen_at: "2026-08-12T00:00:00.000Z" }),
      device("old", { last_seen_at: "2026-08-01T00:00:00.000Z" }),
      device("middle", { last_seen_at: "2026-08-08T00:00:00.000Z" }),
    ]);
    assert.deepEqual(
      result.map((item) => item.id),
      ["old", "middle", "recent"],
    );
  });

  it("falls back to authorization time and breaks ties by id", () => {
    const result = sortReplacementCandidates([
      device("z", {
        approved_at: null,
        created_at: "2026-08-02T00:00:00.000Z",
      }),
      device("a", {
        approved_at: null,
        created_at: "2026-08-02T00:00:00.000Z",
      }),
      device("new", {
        approved_at: "2026-08-03T00:00:00.000Z",
        created_at: "2026-08-01T00:00:00.000Z",
      }),
    ]);
    assert.deepEqual(
      result.map((item) => item.id),
      ["a", "z", "new"],
    );
  });
});
