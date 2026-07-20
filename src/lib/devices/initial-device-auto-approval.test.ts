import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canCreateInitialActivationRestrictedSession,
  hasInitialDeviceAutoApprovalEligibility,
  initialDeviceAutoApprovalEligibleForNewRole,
  type InitialActivationRestrictedSessionInput,
} from "@/lib/devices/initial-device-auto-approval";
import type { User } from "../../../drizzle/schema/users";

function makeUser(
  overrides: Partial<
    Pick<User, "role" | "initialDeviceAutoApprovalEligible">
  > = {},
): Pick<User, "role" | "initialDeviceAutoApprovalEligible"> {
  return {
    role: "staff",
    initialDeviceAutoApprovalEligible: 0,
    ...overrides,
  };
}

function baseRestrictedInput(
  overrides: Partial<InitialActivationRestrictedSessionInput> = {},
): InitialActivationRestrictedSessionInput {
  return {
    role: "staff",
    mustChangePassword: 1,
    initialDeviceAutoApprovalEligible: 1,
    deviceAuthorizationEnabled: true,
    deviceStatus: "pending",
    deviceBelongsToUser: true,
    approvedCount: 0,
    deviceLimit: 2,
    ...overrides,
  };
}

describe("initial device auto-approval eligibility helpers", () => {
  it("new Staff role maps to eligibility 1", () => {
    assert.equal(initialDeviceAutoApprovalEligibleForNewRole("staff"), 1);
  });

  it("new Admin role maps to eligibility 0", () => {
    assert.equal(initialDeviceAutoApprovalEligibleForNewRole("admin"), 0);
  });

  it("hasEligibility requires staff and flag 1", () => {
    assert.equal(
      hasInitialDeviceAutoApprovalEligibility(
        makeUser({ initialDeviceAutoApprovalEligible: 1 }),
      ),
      true,
    );
    assert.equal(
      hasInitialDeviceAutoApprovalEligibility(
        makeUser({ initialDeviceAutoApprovalEligible: 0 }),
      ),
      false,
    );
    assert.equal(
      hasInitialDeviceAutoApprovalEligibility(
        makeUser({
          role: "admin",
          initialDeviceAutoApprovalEligible: 1,
        }),
      ),
      false,
    );
  });
});

describe("canCreateInitialActivationRestrictedSession", () => {
  it("allows staff + mustChange + eligible + pending + approvedCount 0", () => {
    assert.equal(
      canCreateInitialActivationRestrictedSession(baseRestrictedInput()),
      true,
    );
  });

  it("rejects admin", () => {
    assert.equal(
      canCreateInitialActivationRestrictedSession(
        baseRestrictedInput({ role: "admin" }),
      ),
      false,
    );
  });

  it("rejects mustChangePassword=0", () => {
    assert.equal(
      canCreateInitialActivationRestrictedSession(
        baseRestrictedInput({ mustChangePassword: 0 }),
      ),
      false,
    );
  });

  it("rejects eligible=0", () => {
    assert.equal(
      canCreateInitialActivationRestrictedSession(
        baseRestrictedInput({ initialDeviceAutoApprovalEligible: 0 }),
      ),
      false,
    );
  });

  it("rejects approvedCount > 0", () => {
    assert.equal(
      canCreateInitialActivationRestrictedSession(
        baseRestrictedInput({ approvedCount: 1 }),
      ),
      false,
    );
  });

  it("rejects approved device status", () => {
    assert.equal(
      canCreateInitialActivationRestrictedSession(
        baseRestrictedInput({ deviceStatus: "approved" }),
      ),
      false,
    );
  });

  it("rejects rejected device status", () => {
    assert.equal(
      canCreateInitialActivationRestrictedSession(
        baseRestrictedInput({ deviceStatus: "rejected" }),
      ),
      false,
    );
  });

  it("rejects revoked device status", () => {
    assert.equal(
      canCreateInitialActivationRestrictedSession(
        baseRestrictedInput({ deviceStatus: "revoked" }),
      ),
      false,
    );
  });

  it("rejects device not belonging to user", () => {
    assert.equal(
      canCreateInitialActivationRestrictedSession(
        baseRestrictedInput({ deviceBelongsToUser: false }),
      ),
      false,
    );
  });

  it("rejects when device limit already reached", () => {
    assert.equal(
      canCreateInitialActivationRestrictedSession(
        baseRestrictedInput({ approvedCount: 2, deviceLimit: 2 }),
      ),
      false,
    );
  });

  it("rejects when device authorization disabled", () => {
    assert.equal(
      canCreateInitialActivationRestrictedSession(
        baseRestrictedInput({ deviceAuthorizationEnabled: false }),
      ),
      false,
    );
  });
});
