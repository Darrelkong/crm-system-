import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("approval mobile and stack navigation wiring", () => {
  it("forwards approval item navigation from MailMessageList to MailApprovalList", () => {
    const listSource = readFileSync(
      "src/components/mail/prototype/mail-message-list.tsx",
      "utf8",
    );
    const approvalListSource = readFileSync(
      "src/components/mail/approval/mail-approval-list.tsx",
      "utf8",
    );

    assert.match(listSource, /onApprovalItemSelect\?: \(\) => void/);
    assert.match(
      listSource,
      /selectedFolder === "pending_approval"[\s\S]*onItemSelected=\{onApprovalItemSelect\}/,
    );
    assert.match(approvalListSource, /onItemSelected\?: \(\) => void/);
    assert.match(
      approvalListSource,
      /void selectApproval\(row\.id\)[\s\S]*onItemSelected\?\.\(\)/,
    );
  });

  it("wires mobile approval selection to setMobileView(\"detail\")", () => {
    const shellSource = readFileSync(
      "src/components/mail/prototype/mail-prototype-shell.tsx",
      "utf8",
    );

    assert.match(shellSource, /function selectApprovalItem\(\)/);
    assert.match(
      shellSource,
      /selectApprovalItem[\s\S]*setMobileView\("detail"\)/,
    );
    assert.match(
      shellSource,
      /onApprovalItemSelect=\{selectApprovalItem\}/,
    );
  });

  it("resets mobile list mode when production folder changes", () => {
    const shellSource = readFileSync(
      "src/components/mail/prototype/mail-prototype-shell.tsx",
      "utf8",
    );

    assert.match(
      shellSource,
      /setMobileView\(\(current\) => \(current === "compose" \? current : "list"\)\)/,
    );
    assert.match(shellSource, /\[workspace\?\.selectedFolder\]/);
  });

  it("reuses existing mobile back navigation for approval detail", () => {
    const shellSource = readFileSync(
      "src/components/mail/prototype/mail-prototype-shell.tsx",
      "utf8",
    );

    assert.match(
      shellSource,
      /mobileView === "detail"[\s\S]*setMobileView\("list"\)/,
    );
    assert.doesNotMatch(
      readFileSync(
        "src/components/mail/approval/mail-approval-detail-pane.tsx",
        "utf8",
      ),
      /setMobileView/,
    );
  });

  it("wires desktop stack approval selection to setStackPane(\"detail\")", () => {
    const desktopSource = readFileSync(
      "src/components/mail/prototype/mail-desktop-workspace.tsx",
      "utf8",
    );

    assert.match(desktopSource, /function handleApprovalItemSelect\(\)/);
    assert.match(
      desktopSource,
      /handleApprovalItemSelect[\s\S]*setStackPane\("detail"\)/,
    );
    assert.match(
      desktopSource,
      /onApprovalItemSelect=\{handleApprovalItemSelect\}/,
    );
  });

  it("resets desktop stack pane when production folder changes", () => {
    const desktopSource = readFileSync(
      "src/components/mail/prototype/mail-desktop-workspace.tsx",
      "utf8",
    );

    assert.match(
      desktopSource,
      /workspace\?\.selectedFolder[\s\S]*setStackPane\("list"\)/,
    );
  });

  it("keeps wide desktop split-pane reading column for approvals", () => {
    const desktopSource = readFileSync(
      "src/components/mail/prototype/mail-desktop-workspace.tsx",
      "utf8",
    );
    const readingPaneSource = readFileSync(
      "src/components/mail/prototype/mail-reading-pane.tsx",
      "utf8",
    );

    assert.match(desktopSource, /showReadingPane \?/);
    assert.match(desktopSource, /mail-reading-column/);
    assert.match(
      readingPaneSource,
      /selectedFolder === "pending_approval"[\s\S]*MailApprovalDetailPane/,
    );
    assert.match(
      desktopSource,
      /function handleApprovalItemSelect\(\) \{[\s\S]*?if \(!readingPaneFits\) \{\s*setStackPane\("detail"\);\s*\}/,
    );
  });

  it("preserves normal inbox message mobile navigation", () => {
    const shellSource = readFileSync(
      "src/components/mail/prototype/mail-prototype-shell.tsx",
      "utf8",
    );
    const listSource = readFileSync(
      "src/components/mail/prototype/mail-message-list.tsx",
      "utf8",
    );

    assert.match(
      shellSource,
      /function selectMessage\(id: string\)[\s\S]*setMobileView\("detail"\)/,
    );
    assert.match(listSource, /onMessageSelect\?\.\(id\)/);
  });

  it("preserves desktop message selection wiring in wide and stack layouts", () => {
    const desktopSource = readFileSync(
      "src/components/mail/prototype/mail-desktop-workspace.tsx",
      "utf8",
    );

    const wideLayoutListMatches = [
      ...desktopSource.matchAll(
        /<MailMessageList[\s\S]*?onMessageSelect=\{handleSelectMessage\}/g,
      ),
    ];
    assert.ok(
      wideLayoutListMatches.length >= 2,
      "expected both wide and stack layouts to forward message selection",
    );
  });
});

describe("approval navigation security boundaries remain unchanged", () => {
  it("does not move navigation state into approval workspace context", () => {
    const contextSource = readFileSync(
      "src/lib/mail/client/mail-approval-workspace-context.tsx",
      "utf8",
    );

    assert.doesNotMatch(contextSource, /mobileView/);
    assert.doesNotMatch(contextSource, /stackPane/);
    assert.doesNotMatch(contextSource, /setMobileView/);
    assert.doesNotMatch(contextSource, /onItemSelected/);
  });

  it("keeps staff and reviewer scope helpers unchanged", () => {
    const adaptersSource = readFileSync(
      "src/lib/mail/client/mail-workspace-ui-adapters.ts",
      "utf8",
    );
    const detailSource = readFileSync(
      "src/components/mail/approval/mail-approval-detail-pane.tsx",
      "utf8",
    );

    assert.match(adaptersSource, /resolveApprovalWorkspaceListScope/);
    assert.match(detailSource, /showActions = canReview && approval\.status === "pending"/);
  });

  it("keeps attachment fail-closed readiness unchanged", () => {
    const readinessSource = readFileSync(
      "src/lib/mail/client/mail-approval-review-readiness.ts",
      "utf8",
    );
    const detailSource = readFileSync(
      "src/components/mail/approval/mail-approval-detail-pane.tsx",
      "utf8",
    );

    assert.match(readinessSource, /areRevisionAttachmentsBlockingApproval/);
    assert.match(detailSource, /disabled=\{!reviewReady \|\| actionPending\}/);
    assert.match(detailSource, /buildOutboundRevisionAttachmentDownloadHref/);
  });
});

describe("mailbox sidebar classification wiring", () => {
  it("uses resolveMailboxSidebarSections in desktop folder nav", () => {
    const navSource = readFileSync(
      "src/components/mail/prototype/mail-folder-nav.tsx",
      "utf8",
    );

    assert.match(navSource, /resolveMailboxSidebarSections/);
    assert.match(navSource, /mailboxSections\.showSection/);
    assert.match(navSource, /mailboxSections\.sectionLabelKey/);
    assert.doesNotMatch(
      navSource,
      /t\("mail\.sidebar\.sharedMailboxes"\)[\s\S]*personalMailboxes\.map/,
    );
  });

  it("hides Daniel single-personal mailbox subsection in production nav", () => {
    const navSource = readFileSync(
      "src/components/mail/prototype/mail-folder-nav.tsx",
      "utf8",
    );

    assert.match(navSource, /mailboxSections\.showSection && mailboxSections\.sectionLabelKey/);
  });

  it("uses resolveMailboxSidebarSections for mobile folder popover switcher", () => {
    const popoverSource = readFileSync(
      "src/components/mail/prototype/mail-folder-popover.tsx",
      "utf8",
    );

    assert.match(popoverSource, /resolveMailboxSidebarSections/);
    assert.match(popoverSource, /mailboxSections\.showSection/);
    assert.doesNotMatch(popoverSource, /productionMailboxes\.length > 1/);
  });
});
