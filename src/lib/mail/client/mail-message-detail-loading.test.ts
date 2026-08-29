import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("message detail loading contract", () => {
  const context = read("../../../lib/mail/client/mail-workspace-context.tsx");
  const readingPane = read("../../../components/mail/prototype/mail-production-reading-pane.tsx");
  const messageList = read("../../../components/mail/prototype/mail-message-list.tsx");
  const shell = read("../../../components/mail/prototype/mail-prototype-shell.tsx");
  const desktop = read("../../../components/mail/prototype/mail-desktop-workspace.tsx");

  it("routes production inbox row click through shell selectMessage only once", () => {
    assert.match(messageList, /function handleProductionSelect\(id: string\) \{\s*onMessageSelect\?\.\(id\);\s*\}/);
    assert.match(shell, /void workspace\.selectMessage\(id\)/);
    assert.match(desktop, /onMessageSelect=\{handleSelectMessage\}/);
    assert.match(desktop, /setDesktopMailView\("message"\)/);
  });

  it("uses generation guard without orphan access-unavailable state", () => {
    assert.match(context, /if \(requestSequence !== detailRequestSequence\) \{\s*return;/);
    assert.match(context, /if \(state\.selectedMessageId !== messageId\) \{\s*return;/);
    assert.doesNotMatch(
      context,
      /if \(requestSequence === detailRequestSequence && state\.isLoadingDetail\) \{\s*setState\(\{ isLoadingDetail: false \}\);/,
    );
  });

  it("resets detail loading when message list reload clears selection", () => {
    assert.match(context, /selectedMessageId: null,[\s\S]*selectedMessage: null,[\s\S]*isLoadingDetail: false/);
    assert.doesNotMatch(context, /if \(reset\) \{\s*detailRequestSequence \+= 1;/);
  });

  it("shows localized load failure instead of access unavailable for invalid detail state", () => {
    assert.match(readingPane, /if \(!isProductionDetailReady\(detailState\)\) \{/);
    assert.match(readingPane, /common\.loadFailed/);
    assert.doesNotMatch(
      readingPane,
      /if \(!isProductionDetailReady\(detailState\)\) \{[\s\S]*mail\.status\.accessUnavailable/,
    );
  });

  it("keeps reading focus inside main content pane without compose interference", () => {
    assert.match(desktop, /wideDesktopMessageMode/);
    assert.match(desktop, /!showEmbeddedCompose \? mailContentPane : null/);
    assert.match(desktop, /showEmbeddedCompose = composeOpen && composeExpanded/);
    assert.match(desktop, /mail-main-content-pane relative flex min-h-0 min-w-0 flex-1/);
    assert.match(desktop, /<MailReadingPane \{\.\.\.readingPaneProps\} \/>/);
  });

  it("restores list or reading view after compose restore snapshot", () => {
    assert.match(desktop, /mailContentSnapshotRef/);
    assert.match(desktop, /handleToggleComposeExpand/);
    assert.match(desktop, /handleBackToMessageList/);
  });

  it("leaves mobile message navigation unchanged", () => {
    assert.match(shell, /setMobileView\("detail"\)/);
    assert.match(shell, /mail-mobile-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:hidden/);
  });
});
