import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  COMPOSE_COLLAPSED_MAX_HEIGHT_PX,
  COMPOSE_COLLAPSED_MAX_WIDTH_PX,
  COMPOSE_COLLAPSED_MIN_HEIGHT_PX,
  COMPOSE_COLLAPSED_MIN_WIDTH_PX,
  COMPOSE_COLLAPSED_HEIGHT_RATIO,
  COMPOSE_COLLAPSED_WIDTH_RATIO,
  computeCollapsedFloatingComposeLayout,
  computeExpandedFloatingComposeLayout,
} from "@/lib/mail/client/compose-floating-layout";
import { MAIL_COMPOSE_TEXT_COLORS } from "@/components/mail/compose/mail-compose-text-colors";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("compact floating compose layout", () => {
  it("uses gmail-inspired compact width and height clamps", () => {
    const layout = computeCollapsedFloatingComposeLayout({
      contentLeft: 280,
      viewportWidth: 1600,
      viewportHeight: 900,
    });
    assert.equal(layout.position, "fixed");
    assert.ok(layout.width! <= COMPOSE_COLLAPSED_MAX_WIDTH_PX);
    assert.ok(layout.width! >= COMPOSE_COLLAPSED_MIN_WIDTH_PX);
    assert.ok(layout.height! <= COMPOSE_COLLAPSED_MAX_HEIGHT_PX);
    assert.ok(layout.height! >= COMPOSE_COLLAPSED_MIN_HEIGHT_PX);
    assert.ok(layout.width! < 700, "collapsed composer should be smaller than prior half-workspace size");
  });

  it("shrinks width on narrow desktop viewports", () => {
    const layout = computeCollapsedFloatingComposeLayout({
      contentLeft: 240,
      viewportWidth: 900,
      viewportHeight: 800,
    });
    assert.ok(layout.width! < COMPOSE_COLLAPSED_MAX_WIDTH_PX);
    assert.equal(typeof layout.right, "number");
    assert.equal(typeof layout.bottom, "number");
  });

  it("bounds expanded compose to viewport with max content width", () => {
    const layout = computeExpandedFloatingComposeLayout({
      contentLeft: 280,
      viewportHeight: 900,
    });
    assert.equal(layout.position, "fixed");
    assert.ok(typeof layout.top === "number");
    assert.ok(typeof layout.bottom === "number");
    assert.ok(typeof layout.left === "number");
    assert.ok(typeof layout.right === "number");
  });

  it("exports compact ratio constants", () => {
    assert.equal(COMPOSE_COLLAPSED_WIDTH_RATIO, 0.36);
    assert.equal(COMPOSE_COLLAPSED_HEIGHT_RATIO, 0.62);
  });
});

describe("desktop compose gmail-inspired UX wiring", () => {
  const editor = read("../../../components/mail/compose/mail-compose-editor.tsx");
  const portal = read("../../../components/mail/compose/mail-floating-compose-portal.tsx");
  const toolbar = read("../../../components/mail/prototype/mail-formatting-toolbar.tsx");
  const draftHook = read("../../../components/mail/compose/use-mail-compose-draft.tsx");
  const recipientField = read("../../../components/mail/compose/mail-recipient-chips-field.tsx");
  const emoji = read("../../../components/mail/compose/mail-compose-emoji-picker.tsx");
  const palette = read("../../../components/mail/compose/mail-compose-color-palette.tsx");

  it("keeps viewport-fixed portal architecture", () => {
    assert.match(portal, /createPortal\([\s\S]*document\.body/);
    assert.match(portal, /computeCollapsedFloatingComposeLayout/);
    assert.doesNotMatch(portal, /getBoundingClientRect\(\)\.bottom/);
  });

  it("hides Cc and Bcc rows by default on desktop floating compose", () => {
    assert.match(editor, /useState\(false\)/);
    assert.match(editor, /showCcRow/);
    assert.match(editor, /showBccRow/);
    assert.match(editor, /trailing=\{ccBccLinks\}/);
  });

  it("expands Cc or Bcc rows independently from To row links", () => {
    assert.match(editor, /setShowCcRow\(true\)/);
    assert.match(editor, /setShowBccRow\(true\)/);
    assert.match(editor, /label="CC"/);
    assert.match(editor, /label="BCC"/);
  });

  it("collapses empty Cc/Bcc rows on blur without deleting chips", () => {
    assert.match(editor, /onFieldBlur/);
    assert.match(editor, /pendingInput\.trim\(\)/);
    assert.match(recipientField, /onFieldBlur\?\.\(inputValue\)/);
  });

  it("uses lighter email-style address fields on desktop floating compose", () => {
    assert.match(editor, /appearance=\{emailFieldAppearance\}/);
    assert.match(recipientField, /appearance === "email"/);
  });

  it("renders compact formatting toolbar with color popover", () => {
    assert.match(toolbar, /MailComposeColorPalette/);
    assert.doesNotMatch(toolbar, /TEXT_COLORS\.map/);
    assert.match(toolbar, /exec\("bold"\)/);
    assert.match(toolbar, /exec\("italic"\)/);
    assert.match(toolbar, /exec\("underline"\)/);
    assert.match(toolbar, /exec\("insertUnorderedList"\)/);
    assert.match(toolbar, /exec\("insertOrderedList"\)/);
    assert.match(toolbar, /exec\("justifyLeft"\)/);
    assert.match(toolbar, /exec\("indent"\)/);
    assert.match(toolbar, /RemoveFormatting/);
    assert.match(toolbar, /exec\("createLink"/);
  });

  it("provides expanded text color palette", () => {
    assert.ok(MAIL_COMPOSE_TEXT_COLORS.length >= 20);
    assert.match(palette, /MAIL_COMPOSE_TEXT_COLORS\.map/);
  });

  it("preserves paste invisible foreground normalization", () => {
    assert.match(editor, /normalizeInvisiblePastedForeground/);
  });

  it("adds emoji picker to desktop footer", () => {
    assert.match(editor, /MailComposeEmojiPicker/);
    assert.match(emoji, /insertTextAtCaret/);
    assert.match(emoji, /document\.execCommand\("insertText"/);
  });

  it("autosaves meaningful drafts and discards blank drafts on close", () => {
    assert.match(draftHook, /const handleClose = useCallback/);
    assert.match(draftHook, /hasMeaningfulComposeContent/);
    assert.match(draftHook, /await discardDraft\(snapshot\.draftId\)/);
    assert.match(editor, /handleClose\(\)/);
  });

  it("keeps body region flex-grow with internal scroll", () => {
    assert.match(editor, /min-h-0 flex-1 flex-col overflow-hidden/);
    assert.match(editor, /min-h-0 flex-1 overflow-y-auto/);
  });

  it("uses compact signature rendering without empty placeholder gap", () => {
    assert.match(editor, /compact=\{isFloating\}/);
    assert.match(
      read("../../../components/mail/compose/mail-compose-signature-block.tsx"),
      /\(compact \|\| embeddedExpanded\) && !loading && !error && !html/,
    );
  });

  it("does not expose inline image upload action", () => {
    assert.doesNotMatch(editor, /inline image|insertImage|image\/\*/i);
  });
});
