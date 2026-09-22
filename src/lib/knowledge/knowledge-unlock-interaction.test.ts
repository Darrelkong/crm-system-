import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

describe("knowledge unlock interaction", () => {
  it("shows immediate success transition and prefetches knowledge home", () => {
    const form = readFileSync(
      join(root, "src/components/knowledge/knowledge-access-form.tsx"),
      "utf8",
    );
    const page = readFileSync(
      join(root, "src/app/(dashboard)/knowledge/page.tsx"),
      "utf8",
    );
    const home = readFileSync(
      join(root, "src/components/knowledge/knowledge-home-client.tsx"),
      "utf8",
    );

    assert.match(form, /router\.prefetch\("\/knowledge"\)/);
    assert.match(form, /data-knowledge-unlock-success/);
    assert.match(form, /unlockSuccess/);
    assert.match(form, /startTransition/);
    assert.match(form, /router\.replace\(target\)/);
    assert.doesNotMatch(form, /setPassword\(""\)/);
    assert.doesNotMatch(page, /getKnowledgeCatalog/);
    assert.match(home, /fetch\("\/api\/knowledge\/catalog"/);
    assert.match(home, /data-home-catalog-loading/);
  });

  it("prevents duplicate unlock submit while busy or pending", () => {
    const form = readFileSync(
      join(root, "src/components/knowledge/knowledge-access-form.tsx"),
      "utf8",
    );
    assert.match(form, /if \(busy \|\| unlockSuccess\) return/);
    assert.match(form, /disabled=\{busy \|\| isPending\}/);
  });
});
