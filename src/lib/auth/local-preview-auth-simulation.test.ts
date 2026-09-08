import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  isLocalAuthSimulationEnabled,
  LOCAL_AUTH_SIMULATION_FLAG,
} from "@/lib/auth/local-preview-auth-simulation";

describe("local CRM idle-expiry simulation", () => {
  it("requires the explicit local-preview flag", () => {
    assert.equal(
      isLocalAuthSimulationEnabled({
        NODE_ENV: "development",
        [LOCAL_AUTH_SIMULATION_FLAG]: "true",
      }),
      true,
    );
    assert.equal(
      isLocalAuthSimulationEnabled({
        NODE_ENV: "development",
        [LOCAL_AUTH_SIMULATION_FLAG]: "false",
      }),
      false,
    );
  });

  it("is unavailable in production even when explicitly flagged", () => {
    assert.equal(
      isLocalAuthSimulationEnabled({
        NODE_ENV: "production",
        [LOCAL_AUTH_SIMULATION_FLAG]: "true",
      }),
      false,
    );
  });

  it("renders the simulator action only behind the same local flag", () => {
    const layoutSource = readFileSync(
      new URL("../../app/(dashboard)/layout.tsx", import.meta.url),
      "utf8",
    );
    assert.match(layoutSource, /CRM_LOCAL_PREVIEW_AUTH_SIMULATION_ENABLED/);
    assert.match(layoutSource, /LocalPreviewIdleSimulation/);
    assert.match(layoutSource, /NODE_ENV !== "production"/);
  });
});
