import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  MAILBOX_SIDEBAR_PAGE_SIZE,
  mailboxSidebarPageForSelection,
  paginateSidebarMailboxes,
} from "@/lib/mail/client/mail-sidebar-mailbox-pagination";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("draft hydration and persistence", () => {
  const draftHook = read("../../../components/mail/compose/use-mail-compose-draft.tsx");
  const editor = read("../../../components/mail/compose/mail-compose-editor.tsx");
  const shell = read("../../../components/mail/prototype/mail-prototype-shell.tsx");
  const workspace = read("../../../lib/mail/client/mail-workspace-context.tsx");
  const desktop = read("../../../components/mail/prototype/mail-desktop-workspace.tsx");

  it("syncs editor body when draft content arrives after mount", () => {
    assert.match(editor, /skipBodySyncRef/);
    assert.match(editor, /\[state\.draftId, state\.bodyHtml\]/);
    assert.doesNotMatch(editor, /if \(hydratedRef\.current\) return;/);
  });

  it("reads live editor HTML before close and autosave persist", () => {
    assert.match(draftHook, /syncBodyFromEditor/);
    assert.match(draftHook, /bodyHtmlReaderRef/);
    assert.match(draftHook, /syncBodyFromEditor\(\)/);
    assert.match(draftHook, /await waitForSaveIdle\(\)/);
  });

  it("hydrates draft state before loading approval metadata", () => {
    assert.match(
      draftHook,
      /setState\([\s\S]*restored[\s\S]*hydratedRef\.current = true;[\s\S]*loadDraftApproval/,
    );
    assert.match(draftHook, /bootstrapGenerationRef/);
    assert.match(draftHook, /bodyEditGenerationRef/);
  });

  it("uses draft-scoped compose keys and lightweight draft refresh", () => {
    assert.match(shell, /if \(!seed\?\.draftId\) \{\s*setComposeKey/);
    assert.match(shell, /void workspace\.refreshDrafts\(\)/);
    assert.match(workspace, /async function refreshDrafts\(\)/);
    assert.match(desktop, /key=\{composeSeed\?\.draftId \?\? `new-\$\{composeKey\}`\}/);
  });

  it("provides immediate close feedback", () => {
    assert.match(draftHook, /const \[closing, setClosing\]/);
    assert.match(editor, /disabled=\{closing\}/);
  });
});

describe("CC/BCC interaction contract", () => {
  const editor = read("../../../components/mail/compose/mail-compose-editor.tsx");
  const chips = read("../../../components/mail/compose/mail-recipient-chips-field.tsx");

  it("keeps CC/BCC rows open while partial invalid input remains", () => {
    assert.match(chips, /onFieldBlur\?: \(pendingInput: string\) => void/);
    assert.match(chips, /onFieldBlur\?\.\(inputValue\)/);
    assert.match(editor, /ccUserOpenedRef/);
    assert.match(editor, /pendingInput\.trim\(\)/);
  });

  it("uses non-submit CC/BCC toggles that do not steal focus on mousedown", () => {
    assert.match(editor, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
    assert.match(chips, /CC \/ BCC/);
    assert.match(editor, /label="CC"/);
    assert.match(editor, /label="BCC"/);
  });
});

describe("mailbox sidebar pagination", () => {
  const nav = read("../../../components/mail/prototype/mail-folder-nav.tsx");
  const pager = read("../../../components/mail/prototype/mail-sidebar-mailbox-pager.tsx");

  it("paginates desktop mailbox rows at 10 per page", () => {
    assert.equal(MAILBOX_SIDEBAR_PAGE_SIZE, 10);
    const fifty = paginateSidebarMailboxes(
      Array.from({ length: 50 }, (_, index) => ({ id: `box-${index}` })),
      0,
    );
    assert.equal(fifty.pageItems.length, 10);
    assert.equal(fifty.totalPages, 5);
    assert.equal(
      paginateSidebarMailboxes(
        Array.from({ length: 11 }, (_, index) => ({ id: `box-${index}` })),
        1,
      ).pageItems.length,
      1,
    );
  });

  it("keeps selected mailbox discoverable without switching mailbox on page change", () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ id: `box-${index}` }));
    assert.equal(
      mailboxSidebarPageForSelection(items, "box-19", (item) => item.id),
      1,
    );
    assert.match(nav, /PaginatedMailboxNav/);
    assert.match(pager, /\{page \+ 1\} \/ \{totalPages\}/);
  });
});

describe("expanded composer bottom dock", () => {
  const editor = read("../../../components/mail/compose/mail-compose-editor.tsx");
  const toolbar = read("../../../components/mail/prototype/mail-formatting-toolbar.tsx");
  const signature = read("../../../components/mail/compose/mail-compose-signature-block.tsx");
  const globals = read("../../../app/globals.css");

  it("uses one flexible body region without toolbar above body in embedded expanded mode", () => {
    assert.match(editor, /isEmbeddedExpanded = expanded && !isMobile/);
    assert.match(editor, /mail-compose-body-region flex min-h-0 flex-1 flex-col overflow-hidden/);
    assert.match(editor, /mail-compose-body-scroll min-h-0 flex-1 overflow-y-auto/);
    assert.match(editor, /mail-compose-body-editor--embedded-expanded min-h-full/);
  });

  it("renders formatting toolbar in bottom dock for embedded expanded compose", () => {
    assert.match(editor, /mail-compose-bottom-dock/);
    assert.match(editor, /<MailFormattingToolbar editorRef=\{editorRef\} compact dock \/>/);
    assert.match(toolbar, /dock\s*\?/);
  });

  it("removes signature divider that caused full-width dark line in expanded mode", () => {
    assert.match(signature, /embeddedExpanded/);
    assert.match(signature, /showTopDivider = compact && !embeddedExpanded && !loading && Boolean\(html\)/);
    assert.match(signature, /embeddedExpanded\s*\?\s*"px-3 pb-2 pt-1"/);
    assert.match(editor, /embeddedExpanded=\{isEmbeddedExpanded\}/);
  });

  it("keeps floating compact toolbar above body", () => {
    assert.match(editor, /formattingVisible = \(isFloating && !isEmbeddedExpanded\)/);
    assert.match(editor, /MailFormattingToolbar editorRef=\{editorRef\} compact=\{isFloating\}/);
  });

  it("adds bounded bottom spacing to embedded action dock", () => {
    assert.match(editor, /mail-compose-bottom-dock flex shrink-0 flex-col gap-1\.5 border-t crm-border px-3 pb-5 pt-2/);
    assert.match(globals, /\.mail-compose-bottom-dock \{/);
  });
});

describe("draft switch feedback", () => {
  const draftHook = read("../../../components/mail/compose/use-mail-compose-draft.tsx");
  const editor = read("../../../components/mail/compose/mail-compose-editor.tsx");
  const list = read("../../../components/mail/prototype/mail-message-list.tsx");
  const desktop = read("../../../components/mail/prototype/mail-desktop-workspace.tsx");

  it("shows localized draft loading copy only after a short delay", () => {
    assert.match(draftHook, /draftHydrating/);
    assert.match(editor, /mail\.compose\.loadingDraft/);
    assert.match(editor, /setTimeout\([\s\S]*120/);
  });

  it("highlights the active draft row immediately while compose is open", () => {
    assert.match(list, /activeDraftId/);
    assert.match(desktop, /activeDraftId=\{activeDraftId\}/);
    assert.match(draftHook, /bootstrapGenerationRef/);
  });
});

describe("desktop mail viewport height model", () => {
  const shell = read("../../../components/mail/prototype/mail-prototype-shell.tsx");
  const desktop = read("../../../components/mail/prototype/mail-desktop-workspace.tsx");
  const globals = read("../../../app/globals.css");
  const layout = read("../../../app/(dashboard)/mail/layout.tsx");

  it("bounds mail workspace to dashboard viewport height", () => {
    assert.match(shell, /mail-prototype-root flex h-\[calc\(100dvh-var\(--dashboard-header-offset/);
    assert.match(globals, /\.mail-prototype-root \{[\s\S]*overflow: hidden;/);
    assert.match(layout, /flex h-full min-h-0/);
  });

  it("decouples mailbox column height from main content pane", () => {
    assert.match(desktop, /mail-mailbox-column relative flex h-full min-h-0 shrink-0 flex-col/);
    assert.match(desktop, /mail-main-content-pane relative flex min-h-0 min-w-0 flex-1/);
    assert.match(globals, /\.mail-main-content-pane \{[\s\S]*background: var\(--color-crm-bg\);/);
  });
});
