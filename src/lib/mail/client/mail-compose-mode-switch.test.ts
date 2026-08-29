import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("compose mode switch state preservation", () => {
  const desktop = read("../../../components/mail/prototype/mail-desktop-workspace.tsx");
  const host = read("../../../components/mail/compose/mail-compose-desktop-host.tsx");
  const editor = read("../../../components/mail/compose/mail-compose-editor.tsx");
  const draftHook = read("../../../components/mail/compose/use-mail-compose-draft.tsx");
  const shell = read("../../../components/mail/prototype/mail-prototype-shell.tsx");

  it("keeps one desktop compose session mounted across expand and restore", () => {
    assert.match(desktop, /mail-main-content-pane[\s\S]*<MailComposeDesktopHost[\s\S]*\{composeEditor\}/);
    assert.doesNotMatch(desktop, /MailFloatingComposePortal/);
    assert.doesNotMatch(desktop, /showEmbeddedCompose \? \([\s\S]*composeEditor/);
    assert.match(host, /data-compose-host=\{expanded \? "embedded" : "floating"\}/);
  });

  it("preserves floating body on expand via synchronous editor sync", () => {
    assert.match(editor, /skipBodySyncRef\.current = true;/);
    assert.match(editor, /syncBodyFromEditor\(\);[\s\S]*onToggleExpand\(\)/);
    assert.doesNotMatch(editor, /flushSave\(\)\.then\(\(\) => onToggleExpand\(\)\)/);
  });

  it("uses one contentEditable editor node for floating and expanded layouts", () => {
    const editorNodes = editor.match(/ref=\{editorRef\}/g) ?? [];
    assert.equal(editorNodes.length, 1);
    assert.doesNotMatch(
      editor,
      /isEmbeddedExpanded \? \([\s\S]*ref=\{editorRef\}[\s\S]*\) : \([\s\S]*ref=\{editorRef\}/,
    );
  });

  it("does not bump compose session identity on expand toggle", () => {
    assert.match(shell, /onToggleComposeExpand=\{\(\) => setComposeExpanded\(\(v\) => !v\)\}/);
    assert.doesNotMatch(shell, /onToggleComposeExpand[\s\S]*setComposeKey/);
    assert.match(desktop, /key=\{composeSeed\?\.draftId \?\? `new-\$\{composeKey\}`\}/);
  });

  it("does not fetch draft when only layout mode changes", () => {
    assert.match(draftHook, /if \(input\.seed\?\.draftId\) \{/);
    assert.doesNotMatch(
      editor,
      /expanded[\s\S]*fetchDraft/,
    );
  });

  it("guards stale draft hydration from overwriting newer live body edits", () => {
    assert.match(draftHook, /bodyEditGenerationRef/);
    assert.match(draftHook, /bodyEditGenerationAtStart/);
    assert.match(draftHook, /hasLiveBodyEdits/);
    assert.match(draftHook, /bodyHtml: current\.bodyHtml/);
  });

  it("exports syncBodyFromEditor for layout-only transitions", () => {
    assert.match(draftHook, /syncBodyFromEditor,/);
    assert.match(editor, /syncBodyFromEditor=\{syncBodyFromEditor\}/);
  });

  it("preserves subject, recipients, attachments, and reply context in shared session state", () => {
    assert.match(editor, /value=\{state\.subject\}/);
    assert.match(editor, /chips=\{state\.to\}/);
    assert.match(editor, /chips=\{state\.cc\}/);
    assert.match(editor, /chips=\{state\.bcc\}/);
    assert.match(editor, /attachments=\{state\.attachments\}/);
    assert.match(editor, /state\.quotedBodyHtml/);
  });

  it("does not create a new draft during expand or restore", () => {
    assert.doesNotMatch(editor, /createDraft/);
    assert.match(draftHook, /if \(!snapshot\.draftId\) \{/);
  });
});

describe("compose transient divider guard", () => {
  const editor = read("../../../components/mail/compose/mail-compose-editor.tsx");
  const signature = read("../../../components/mail/compose/mail-compose-signature-block.tsx");

  it("never renders compact signature divider while signature is loading", () => {
    assert.match(signature, /showTopDivider = compact && !embeddedExpanded && !loading && Boolean\(html\)/);
    assert.match(signature, /showTopDivider\s*\?\s*"border-t crm-border\/70 px-3 py-2"/);
  });

  it("passes embeddedExpanded to signature during expanded desktop compose", () => {
    assert.match(
      editor,
      /MailComposeSignatureBlock[\s\S]*compact=\{isFloating && !isEmbeddedExpanded\}[\s\S]*embeddedExpanded=\{isEmbeddedExpanded\}/,
    );
  });

  it("does not render signature placeholder divider when no signature is configured", () => {
    assert.match(signature, /if \(\(compact \|\| embeddedExpanded\) && !loading && !error && !html\) \{\s*return null;/);
  });

  it("keeps expanded signature spacing without top divider class", () => {
    assert.match(signature, /embeddedExpanded\s*\?\s*"px-3 pb-2 pt-1"/);
  });
});
