import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("expanded composer main content pane boundary", () => {
  const desktop = read("../../../components/mail/prototype/mail-desktop-workspace.tsx");
  const host = read("../../../components/mail/compose/mail-compose-desktop-host.tsx");
  const layout = read("../../../lib/mail/client/compose-floating-layout.ts");
  const editor = read("../../../components/mail/compose/mail-compose-editor.tsx");

  it("anchors expanded composer inside the main mail content pane", () => {
    assert.match(desktop, /mainContentPaneRef = useRef<HTMLDivElement>\(null\)/);
    assert.match(desktop, /className="mail-main-content-pane relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"/);
    assert.match(desktop, /ref=\{mainContentPaneRef\}/);
    assert.match(desktop, /data-mail-main-content-pane/);
    assert.match(desktop, /<MailComposeDesktopHost[\s\S]*mainContentPaneRef=\{mainContentPaneRef\}/);
    assert.match(host, /mainContentPaneRef: React\.RefObject<HTMLElement \| null>/);
    assert.match(host, /expanded\s*\?\s*"absolute inset-0 z-10"/);
  });

  it("does not derive expanded bounds from workspace root or viewport magic offsets", () => {
    assert.doesNotMatch(host, /workspaceRef/);
    assert.doesNotMatch(host, /inset-y-0 right-0/);
    assert.doesNotMatch(host, /left: contentLeft/);
    assert.doesNotMatch(host, /COMPOSE_MAIL_HEADER_OFFSET_PX/);
    assert.doesNotMatch(host, /computeExpandedFloatingComposeLayout/);
    assert.doesNotMatch(desktop, /MailComposeDesktopHost[\s\S]*workspaceRef=\{workspaceRef\}/);
  });

  it("keeps expanded composer below the global mail header region", () => {
    assert.match(host, /expanded\s*\?\s*undefined : floatingLayout/);
    assert.doesNotMatch(host, /position: "fixed"[\s\S]*expanded/);
    assert.match(
      read("../../../components/mail/prototype/mail-prototype-shell.tsx"),
      /mail-prototype-root flex h-\[calc\(100dvh-var\(--dashboard-header-offset/,
    );
  });

  it("leaves the mail folder pane outside expanded composer bounds", () => {
    assert.match(desktop, /mail-mailbox-column relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r crm-border/);
    assert.match(desktop, /mail-main-content-pane relative flex min-h-0 min-w-0 flex-1/);
    assert.match(
      desktop,
      /mail-main-content-pane[\s\S]*<MailComposeDesktopHost[\s\S]*mainContentPaneRef=\{mainContentPaneRef\}/,
    );
  });

  it("replaces the message list/read slot when expanded", () => {
    assert.match(desktop, /!showEmbeddedCompose \? mailContentPane : null/);
    assert.match(desktop, /showEmbeddedCompose = composeOpen && composeExpanded/);
    assert.match(desktop, /wideDesktopListMode[\s\S]*!showEmbeddedCompose/);
  });

  it("restores message list/read pane on restore", () => {
    assert.match(desktop, /mailContentSnapshotRef/);
    assert.match(desktop, /handleToggleComposeExpand/);
    assert.match(desktop, /setDesktopMailView\(mailContentSnapshotRef\.current\.desktopMailView\)/);
  });

  it("avoids a double left divider on expanded composer", () => {
    assert.match(host, /expanded\s*\?\s*"absolute inset-0 z-10"/);
    assert.doesNotMatch(host, /expanded\s*\?\s*"[^"]*border/);
    assert.doesNotMatch(host, /border-l/);
  });

  it("uses one subtle folder/content separator via mailbox column border", () => {
    assert.match(desktop, /mail-mailbox-column[\s\S]*border-r crm-border/);
    assert.match(
      read("../../../app/globals.css"),
      /\.mail-main-content-pane \{[\s\S]*background: var\(--color-crm-bg\);/,
    );
  });

  it("keeps floating composer viewport anchored to main content left edge", () => {
    assert.match(host, /readMainContentPaneLeft\(mainContentPaneRef\.current\)/);
    assert.match(host, /computeCollapsedFloatingComposeLayout/);
    assert.match(layout, /position: "fixed"/);
    assert.match(layout, /COMPOSE_MAIL_HEADER_OFFSET_PX/);
  });

  it("recalculates floating bounds on pane resize", () => {
    assert.match(host, /ResizeObserver\(update\)/);
    assert.match(host, /window\.addEventListener\("resize", update\)/);
  });

  it("does not tie expanded composer height to mailbox pagination count", () => {
    assert.doesNotMatch(host, /MAILBOX_SIDEBAR_PAGE_SIZE/);
    assert.doesNotMatch(desktop, /mail-main-content-pane[\s\S]*PaginatedMailboxNav/);
    assert.match(host, /expanded\s*\?\s*"absolute inset-0 z-10"/);
  });

  it("preserves single-session expand/restore behavior", () => {
    assert.match(desktop, /key=\{composeSeed\?\.draftId \?\? `new-\$\{composeKey\}`\}/);
    assert.match(editor, /syncBodyFromEditor\(\);[\s\S]*onToggleExpand\(\)/);
    assert.match(editor, /mail-compose-bottom-dock/);
  });

  it("leaves mobile compose path unchanged", () => {
    const shell = read("../../../components/mail/prototype/mail-prototype-shell.tsx");
    assert.match(shell, /mail-mobile-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:hidden/);
    assert.match(shell, /variant="embedded-mobile"/);
    assert.doesNotMatch(shell, /mainContentPaneRef/);
  });
});

describe("expanded composer responsive geometry", () => {
  const host = read("../../../components/mail/compose/mail-compose-desktop-host.tsx");

  it("fills the main content pane at 1366-class widths without manual top offsets", () => {
    assert.match(host, /absolute inset-0/);
    assert.doesNotMatch(host, /top:\s*\d+/);
    assert.doesNotMatch(host, /100vh/);
  });

  it("fills the main content pane at 1920-class widths without workspace-root left math", () => {
    assert.doesNotMatch(host, /style=\{expanded \? \{ left:/);
    assert.doesNotMatch(host, /getBoundingClientRect\(\)\.top/);
  });
});
