import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  isInvisibleForegroundColor,
  normalizeInvisiblePastedForeground,
} from "@/lib/mail/client/compose-paste-normalization";

describe("compose paste normalization", () => {
  it("detects invisible white foreground colors", () => {
    assert.equal(isInvisibleForegroundColor("#ffffff"), true);
    assert.equal(isInvisibleForegroundColor("white"), true);
    assert.equal(isInvisibleForegroundColor("#000000"), false);
  });

  it("removes invisible pasted foreground colors while preserving markup", () => {
    const normalized = normalizeInvisiblePastedForeground(
      '<p style="color:#ffffff"><strong>Hello</strong></p>',
    );
    assert.match(normalized, /<strong>Hello<\/strong>/);
    assert.doesNotMatch(normalized, /color:\s*#ffffff/i);
  });
});

describe("mail compose reply regression wiring", () => {
  it("does not render full-workspace compose overlay wrapper", () => {
    const source = readFileSync(
      new URL(
        "../../../components/mail/prototype/mail-desktop-workspace.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.doesNotMatch(source, /pointer-events-none absolute inset-0 z-20/);
    assert.match(source, /MailComposeDesktopHost/);
    assert.match(
      readFileSync(
        new URL(
          "../../../components/mail/compose/mail-compose-desktop-host.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      /computeCollapsedFloatingComposeLayout/,
    );
  });

  it("hides pane resizers while compose is open", () => {
    const source = readFileSync(
      new URL(
        "../../../components/mail/prototype/mail-desktop-workspace.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(source, /!composeOpen \? \(\s*<MailPaneResizer/);
  });

  it("shows formatting toolbar by default in compose editor", () => {
    const source = readFileSync(
      new URL(
        "../../../components/mail/compose/mail-compose-editor.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(source, /formattingVisible = \(isFloating && !isEmbeddedExpanded\) \|\| showFormatting/);
    assert.match(source, /MailFormattingToolbar/);
    assert.match(source, /normalizeInvisiblePastedForeground/);
  });

  it("exposes clear formatting in shared toolbar", () => {
    const source = readFileSync(
      new URL(
        "../../../components/mail/prototype/mail-formatting-toolbar.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(source, /RemoveFormatting/);
    assert.match(source, /mail\.compose\.clearFormatting/);
    assert.match(source, /exec\("bold"\)/);
    assert.match(source, /exec\("italic"\)/);
    assert.match(source, /applySize/);
    assert.match(source, /MailComposeColorPalette/);
    assert.match(source, /onSelectColor=\{\(color\) => exec\("foreColor", color\)\}/);
  });

  it("starts attachment upload queue after ref sync and persisted draft barrier", () => {
    const source = readFileSync(
      new URL(
        "../../../components/mail/compose/use-mail-compose-draft.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(source, /uploadAttachmentsRef\.current = next/);
    assert.match(source, /queueMicrotask\(\(\) => \{\s*void processUploadQueue\(\)/);
    assert.match(source, /useEffect\(\(\) => \{[\s\S]*processUploadQueue/);
    assert.match(source, /ensurePersistedDraft/);
    assert.match(source, /allowEmptyShell: true/);
    assert.match(source, /persistInFlightRef/);
    assert.doesNotMatch(
      source,
      /Draft must be saved before uploading attachments/,
    );
  });

  it("surfaces failed attachment state with retry affordance", () => {
    const list = readFileSync(
      new URL(
        "../../../components/mail/compose/mail-compose-attachment-list.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(list, /uploadStatus === "failed"/);
    assert.match(list, /mail\.compose\.attachment\.retry/);
    assert.match(list, /mail\.compose\.attachment\.uploadFailed/);
    assert.match(list, /composeAttachmentRemoveMessageKey/);
    assert.doesNotMatch(list, /mail\.recipient\.remove/);
  });
});
