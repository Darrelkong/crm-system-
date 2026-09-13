import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DASHBOARD_SHELL_CRITICAL_CSS } from "./dashboard-shell-critical-css";

describe("dashboard shell critical css", () => {
  it("covers first-paint dashboard and knowledge shell selectors", () => {
    assert.match(DASHBOARD_SHELL_CRITICAL_CSS, /\.dashboard-shell/);
    assert.match(DASHBOARD_SHELL_CRITICAL_CSS, /\.surface-card/);
    assert.match(DASHBOARD_SHELL_CRITICAL_CSS, /\.page-title/);
    assert.match(DASHBOARD_SHELL_CRITICAL_CSS, /\.primary-button/);
    assert.match(DASHBOARD_SHELL_CRITICAL_CSS, /\.nav-item/);
    assert.match(DASHBOARD_SHELL_CRITICAL_CSS, /\.mobile-bottom-nav/);
    assert.match(DASHBOARD_SHELL_CRITICAL_CSS, /\[data-lifecycle-list\]/);
    assert.match(DASHBOARD_SHELL_CRITICAL_CSS, /a \{/);
    assert.doesNotMatch(DASHBOARD_SHELL_CRITICAL_CSS, /visibility:\s*hidden/);
  });

  it("is inlined in root layout head", () => {
    const layout = readFileSync(
      join(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    );
    assert.match(layout, /dashboard-shell-critical/);
    assert.match(layout, /DASHBOARD_SHELL_CRITICAL_CSS/);
  });
});
