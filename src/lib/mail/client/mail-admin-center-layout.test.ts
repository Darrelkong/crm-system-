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
    assert.doesNotMatch(drawer, /-mx-5/);
    assert.doesNotMatch(drawer, /mail-admin-center-panel mx-auto max-w-5xl/);
    assert.match(globals, /\.qe-drawer-panel--workspace/);
    assert.match(globals, /min\(88vw, 1180px\)/);
    assert.match(globals, /grid-template-columns: 240px minmax\(0, 1fr\)/);
  });

  it("has two direct layout regions for nav and content", () => {
    const drawer = readFileSync(
      "src/components/mail/admin/mail-admin-center-drawer.tsx",
      "utf8",
    );
    const globals = readFileSync("src/app/globals.css", "utf8");

    assert.match(drawer, /className="mail-admin-center-layout"/);
    assert.match(drawer, /<aside className="mail-admin-center-sidebar"/);
    assert.match(drawer, /className="mail-admin-center-content"/);
    assert.doesNotMatch(drawer, /mail-admin-center-layout flex/);
    assert.doesNotMatch(drawer, /flex-col/);
    assert.match(globals, /\.mail-admin-center-sidebar[\s\S]*max-width: 240px/);
    assert.match(globals, /\.mail-admin-center-content[\s\S]*overflow-y: auto/);
  });

  it("keeps desktop nav constrained to sidebar column", () => {
    const nav = readFileSync(
      "src/components/mail/admin/mail-admin-center-nav.tsx",
      "utf8",
    );
    const globals = readFileSync("src/app/globals.css", "utf8");

    assert.match(nav, /mail-admin-center-nav-list/);
    assert.doesNotMatch(nav, /md:block/);
    assert.doesNotMatch(nav, /md:w-full/);
    assert.match(globals, /\.mail-admin-center-nav-item[\s\S]*width: 100%/);
    assert.match(globals, /\.mail-admin-center-sidebar[\s\S]*width: 240px/);
  });

  it("ignores backdrop clicks for mail admin center", () => {
    const drawer = readFileSync(
      "src/components/mail/admin/mail-admin-center-drawer.tsx",
      "utf8",
    );
    const quickEntryDrawer = readFileSync(
      "src/components/ui/quick-entry-drawer.tsx",
      "utf8",
    );

    assert.match(drawer, /closeOnOverlayClick=\{false\}/);
    assert.match(quickEntryDrawer, /closeOnOverlayClick\?: boolean/);
    assert.match(
      quickEntryDrawer,
      /if \(!closeBlocked && closeOnOverlayClick\) onRequestClose\(\)/,
    );
    assert.match(quickEntryDrawer, /if \(event\.key === "Escape"\)/);
    assert.match(quickEntryDrawer, /qe-drawer-close/);
  });

  it("defines scroll and min-height overflow hierarchy", () => {
    const globals = readFileSync("src/app/globals.css", "utf8");

    assert.match(
      globals,
      /\.qe-drawer-panel--workspace \.qe-drawer-body[\s\S]*min-height: 0/,
    );
    assert.match(
      globals,
      /\.qe-drawer-panel--workspace \.qe-drawer-body[\s\S]*overflow: hidden/,
    );
    assert.match(globals, /\.mail-admin-center-layout[\s\S]*min-height: 0/);
    assert.match(globals, /\.mail-admin-center-layout[\s\S]*height: 100%/);
    assert.match(globals, /\.mail-admin-center-content[\s\S]*overflow-y: auto/);
    assert.match(globals, /\.mail-admin-center-sidebar[\s\S]*overflow-y: auto/);
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
