import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

describe("knowledge ingest paste submit preview stacking", () => {
  it("keeps local preview idle simulation below mobile create sheet", () => {
    const idle = readFileSync(
      join(root, "src/components/auth/local-preview-idle-simulation.tsx"),
      "utf8",
    );
    const sheet = readFileSync(
      join(root, "src/components/knowledge/knowledge-mobile-sheet.tsx"),
      "utf8",
    );
    assert.match(idle, /z-40/);
    assert.match(sheet, /z-50/);
  });
});
