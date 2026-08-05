import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("reclamation countdown responsive layout", () => {
  it("renders countdown inside flex-wrap badge rows on mobile and desktop", () => {
    const client = readFileSync(
      "src/app/(dashboard)/customers/customers-list-client.tsx",
      "utf8",
    );
    assert.match(client, /ReclamationCountdownBadge/);
    assert.match(client, /mt-3 flex flex-wrap gap-1\.5/);
    assert.match(client, /flex flex-wrap gap-1/);
    assert.match(client, /md:hidden/);
    assert.match(client, /hidden md:block/);
  });

  it("badge component avoids timers and large UI libraries", () => {
    const badge = readFileSync(
      "src/components/customers/reclamation-countdown-badge.tsx",
      "utf8",
    );
    assert.doesNotMatch(badge, /setInterval|setTimeout|requestAnimationFrame/);
    assert.doesNotMatch(badge, /@radix-ui|floating-ui|tippy/);
    assert.match(badge, /title=\{title\}/);
  });
});
