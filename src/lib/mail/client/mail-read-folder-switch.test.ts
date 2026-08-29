import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("mail read folder switch wiring", () => {
  const context = read("../../../lib/mail/client/mail-workspace-context.tsx");
  const folderNav = read("../../../components/mail/prototype/mail-folder-nav.tsx");
  const desktop = read("../../../components/mail/prototype/mail-desktop-workspace.tsx");
  const messageList = read("../../../components/mail/prototype/mail-message-list.tsx");

  it("updates selected folder before async folder loads", () => {
    assert.match(context, /if \(folder !== state\.selectedFolder\) \{\s*setState\(\{ selectedFolder: folder \}\);/);
    assert.match(folderNav, /void workspace\.selectFolder\(/);
  });

  it("keeps mailbox id on folder switches through loadMessages and loadDrafts", () => {
    const selectFolderBlock = context.match(
      /async function selectFolder[\s\S]*?async function selectMessage/,
    )?.[0];
    assert.ok(selectFolderBlock, "expected selectFolder block");
    assert.match(context, /selectedMailboxId: input\.mailboxId/);
    assert.match(context, /\.\.\.\(mailboxId \? \{ selectedMailboxId: mailboxId \} : \{\}\)/);
    assert.doesNotMatch(selectFolderBlock!, /selectedMailboxId: null/);
  });

  it("clears stale list loading when folder responses are discarded", () => {
    assert.match(
      context,
      /if \(requestSequence === messagesRequestSequence\) \{\s*setState\(\{ isLoadingMessages: false \}\);/,
    );
  });

  it("does not blank cached inbox rows during folder refresh reset", () => {
    const loadMessagesBlock = context.match(
      /async function loadMessages[\s\S]*?async function loadMoreMessages/,
    )?.[0];
    assert.ok(loadMessagesBlock, "expected loadMessages block");
    assert.doesNotMatch(loadMessagesBlock!, /reset\s*\?\s*\{[\s\S]*messages: \[\],/);
  });

  it("routes inbox row click through shell selectMessage only once", () => {
    assert.match(messageList, /function handleProductionSelect\(id: string\) \{\s*onMessageSelect\?\.\(id\);\s*\}/);
  });

  it("keeps reading focus in main content pane without compose remount", () => {
    assert.match(desktop, /mail-main-content-pane relative flex min-h-0 min-w-0 flex-1/);
    assert.match(desktop, /!showEmbeddedCompose \? mailContentPane : null/);
  });
});

describe("mail read detail error presentation", () => {
  const adapters = read("../../../lib/mail/client/mail-workspace-ui-adapters.ts");
  const readingPane = read("../../../components/mail/prototype/mail-production-reading-pane.tsx");

  it("maps real authorization failures to access unavailable only", () => {
    assert.match(adapters, /error\.status === 401 \|\| error\.status === 403/);
    assert.match(adapters, /return "mail\.status\.accessUnavailable"/);
  });

  it("maps not-found and server failures to generic load failed", () => {
    assert.match(adapters, /error\.status === 404/);
    assert.match(adapters, /return "common\.loadFailed"/);
  });

  it("does not use access unavailable for invalid hydrated detail state", () => {
    assert.match(readingPane, /if \(!isProductionDetailReady\(detailState\)\) \{/);
    assert.match(readingPane, /t\("common\.loadFailed"\)/);
    assert.doesNotMatch(
      readingPane,
      /if \(!isProductionDetailReady\(detailState\)\) \{[\s\S]*mail\.status\.accessUnavailable/,
    );
  });
});
