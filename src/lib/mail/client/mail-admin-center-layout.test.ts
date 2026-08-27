import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("mail admin center desktop layout", () => {
  it("uses wide workspace drawer variant on desktop", () => {
    const drawer = readFileSync(
      "src/components/mail/admin/mail-admin-center-drawer.tsx",
      "utf8",
    );
    const globals = readFileSync("src/app/globals.css", "utf8");

    assert.match(drawer, /panelClassName="qe-drawer-panel--workspace"/);
    assert.match(drawer, /md:w-60/);
    assert.doesNotMatch(drawer, /mail-admin-center-panel mx-auto max-w-5xl/);
    assert.match(globals, /\.qe-drawer-panel--workspace/);
    assert.match(globals, /min\(78vw, 1080px\)/);
  });

  it("uses definition rows without break-all on labels", () => {
    const states = readFileSync(
      "src/components/mail/admin/mail-admin-states.tsx",
      "utf8",
    );
    const globals = readFileSync("src/app/globals.css", "utf8");
    const overview = readFileSync(
      "src/components/mail/admin/mail-admin-overview.tsx",
      "utf8",
    );

    assert.match(states, /export function MailAdminDefinitionRow/);
    assert.match(globals, /\.mail-admin-definition-label/);
    assert.match(globals, /white-space: nowrap/);
    assert.match(overview, /MailAdminDefinitionRow/);
    assert.doesNotMatch(overview, /break-all/);
    assert.match(overview, /mail-admin-capability-list/);
    assert.match(overview, /effectiveMailAccessEnabled/);
    assert.match(overview, /mailAccessSystem/);
  });

  it("keeps approval workflow summary-only in management center", () => {
    const source = readFileSync(
      "src/components/mail/admin/approval-workflow-management.tsx",
      "utf8",
    );
    assert.match(source, /workspaceHint/);
    assert.match(source, /openWorkspace/);
    assert.match(source, /effectiveScope === "reviewer"/);
  });
});
