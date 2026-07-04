import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { customers } from "../../../drizzle/schema/customers";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";
import { validateSettingValue } from "@/lib/settings/validation";
import {
  COLLABORATIVE_DISSOLUTION_THRESHOLD_DAYS,
  parseCollaborativeDissolutionEnabled,
} from "./collaborative-dry-run";

describe("C-3 migration / schema", () => {
  it("customers schema includes collaborativeDissolvedAt", () => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        customers,
        "collaborativeDissolvedAt",
      ),
      true,
    );
  });

  it("0027 migration only adds nullable collaborative_dissolved_at column", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "drizzle/migrations/0027_collaborative_dissolved_at.sql",
      ),
      "utf8",
    );

    assert.match(sql, /ADD COLUMN collaborative_dissolved_at TEXT/i);
    assert.doesNotMatch(sql, /\bDROP\b/i);
    assert.doesNotMatch(sql, /\bDELETE\b/i);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  });
});

describe("C-3 collaborative dissolution feature flag", () => {
  it("collaborative_dissolution_enabled defaults to false", () => {
    assert.equal(SETTING_DEFAULTS.collaborative_dissolution_enabled, "false");
  });

  it("parseCollaborativeDissolutionEnabled returns false by default", () => {
    assert.equal(
      parseCollaborativeDissolutionEnabled(SETTING_DEFAULTS),
      false,
    );
  });

  it("parseCollaborativeDissolutionEnabled returns true only when stored as true", () => {
    assert.equal(
      parseCollaborativeDissolutionEnabled({
        ...SETTING_DEFAULTS,
        collaborative_dissolution_enabled: "true",
      }),
      true,
    );
    assert.equal(
      parseCollaborativeDissolutionEnabled({
        ...SETTING_DEFAULTS,
        collaborative_dissolution_enabled: "false",
      }),
      false,
    );
  });

  it("validates collaborative_dissolution_enabled as boolean string", () => {
    assert.equal(
      validateSettingValue("collaborative_dissolution_enabled", "true"),
      null,
    );
    assert.equal(
      validateSettingValue("collaborative_dissolution_enabled", "false"),
      null,
    );
    assert.equal(
      validateSettingValue("collaborative_dissolution_enabled", "yes"),
      "必须为 true 或 false",
    );
  });

  it("default threshold is 90 days", () => {
    assert.equal(COLLABORATIVE_DISSOLUTION_THRESHOLD_DAYS, 90);
  });
});
