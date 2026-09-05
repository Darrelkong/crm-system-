import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerOwnerOptions,
  formatCustomerOwnerOptionLabel,
} from "./owner-options";

describe("customer owner options", () => {
  it("puts the current admin first and keeps active Staff candidates", () => {
    assert.deepEqual(
      buildCustomerOwnerOptions(
        { id: "admin-1", displayName: "Darrell Koo", role: "admin" },
        [
          { id: "staff-1", displayName: "Rowen Lei" },
          { id: "staff-2", displayName: "Jerry Jiao" },
        ],
      ),
      [
        { id: "admin-1", displayName: "Darrell Koo", role: "admin" },
        { id: "staff-1", displayName: "Rowen Lei", role: "staff" },
        { id: "staff-2", displayName: "Jerry Jiao", role: "staff" },
      ],
    );
  });

  it("does not expose owner options to Staff", () => {
    assert.deepEqual(
      buildCustomerOwnerOptions(
        { id: "staff-1", displayName: "Rowen Lei", role: "staff" },
        [{ id: "staff-2", displayName: "Jerry Jiao" }],
      ),
      [],
    );
  });

  it("marks the current admin with the localized role label", () => {
    assert.equal(
      formatCustomerOwnerOptionLabel(
        { id: "admin-1", displayName: "Darrell Koo", role: "admin" },
        "Admin",
      ),
      "Darrell Koo（Admin）",
    );
  });
});
