import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("staff directory privacy", () => {
  it("requires Admin authentication before listing staff", () => {
    const route = source("src/app/api/users/staff/route.ts");

    assert.match(route, /requireAdmin\(request\)/);
    assert.doesNotMatch(route, /requireAuth\(request\)/);
  });

  it("keeps Staff transfer on exact-email verification", () => {
    const modal = source(
      "src/components/customers/customer-approval-requests-modal.tsx",
    );

    assert.match(modal, /if \(!isAdmin\) return/);
    assert.match(modal, /\/transfer\/verify-target/);
    assert.match(modal, /transferTargetEmail/);
    assert.match(modal, /verifiedTransferTarget/);
    assert.doesNotMatch(
      modal,
      /isAdmin \?[\s\S]*?fetch\(["']\/api\/users\/staff/,
    );
  });
});
