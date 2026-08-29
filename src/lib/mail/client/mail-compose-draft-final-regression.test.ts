import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  MAIL_COMPOSE_EMOJI_COUNT,
  MAIL_COMPOSE_EMOJI_CATEGORIES,
} from "@/lib/mail/client/mail-compose-emoji-data";
import { sortDraftsByRecency } from "@/lib/mail/client/draft-management";
import { MAIL_COMPOSE_TEXT_COLORS } from "@/components/mail/compose/mail-compose-text-colors";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("compose CC/BCC terminology", () => {
  const editor = read("../../../components/mail/compose/mail-compose-editor.tsx");

  it("uses fixed CC/BCC labels on desktop floating compose", () => {
    assert.match(editor, /label="CC"/);
    assert.match(editor, /label="BCC"/);
    assert.match(editor, />\s*CC\s*</);
    assert.match(editor, />\s*BCC\s*</);
  });
});

describe("compose popover visibility", () => {
  const palette = read("../../../components/mail/compose/mail-compose-color-palette.tsx");
  const emoji = read("../../../components/mail/compose/mail-compose-emoji-picker.tsx");
  const popover = read("../../../components/mail/compose/mail-compose-anchored-popover.tsx");

  it("renders color palette through a body-level anchored popover", () => {
    assert.match(palette, /MailComposeAnchoredPopover/);
    assert.match(popover, /createPortal\([\s\S]*document\.body/);
    assert.match(popover, /position: "fixed"/);
    assert.match(popover, /zIndex: POPOVER_Z_INDEX/);
  });

  it("renders emoji picker through anchored popover with search and categories", () => {
    assert.match(emoji, /MailComposeAnchoredPopover/);
    assert.match(emoji, /mail\.compose\.emojiSearch/);
    assert.match(emoji, /MAIL_COMPOSE_EMOJI_CATEGORIES/);
  });

  it("keeps expanded text color palette count", () => {
    assert.ok(MAIL_COMPOSE_TEXT_COLORS.length >= 30);
  });
});

describe("emoji catalog", () => {
  it("provides a substantially expanded unicode emoji catalog", () => {
    assert.ok(MAIL_COMPOSE_EMOJI_COUNT >= 200);
    assert.equal(MAIL_COMPOSE_EMOJI_CATEGORIES.length, 9);
  });
});

describe("draft save and ordering", () => {
  const draftHook = read("../../../components/mail/compose/use-mail-compose-draft.tsx");
  const draftService = read("../../../lib/mail/draft-service.ts");
  const workspace = read("../../../lib/mail/client/mail-workspace-context.tsx");
  const shell = read("../../../components/mail/prototype/mail-prototype-shell.tsx");
  const desktop = read("../../../components/mail/prototype/mail-desktop-workspace.tsx");

  it("awaits in-flight save and blocks close when persist fails", () => {
    assert.match(draftHook, /await waitForSaveIdle\(\)/);
    assert.match(draftHook, /if \(!saved\) \{\s*return;\s*\}/);
    assert.match(draftHook, /onDraftPersisted\?\.\(\)/);
  });

  it("sorts drafts by updated time descending on server and client", () => {
    assert.match(draftService, /desc\(schema\.mailDrafts\.updatedAt\)/);
    assert.match(draftService, /desc\(schema\.mailDrafts\.createdAt\)/);
    assert.match(workspace, /sortDraftsByRecency\(items\)/);
  });

  it("sortDraftsByRecency puts newest draft first", () => {
    const sorted = sortDraftsByRecency([
      {
        id: "old",
        updatedAt: "2026-08-27T10:00:00.000Z",
        lastSavedAt: "2026-08-27T10:00:00.000Z",
        createdAt: "2026-08-27T09:00:00.000Z",
      },
      {
        id: "new",
        updatedAt: "2026-08-28T10:00:00.000Z",
        lastSavedAt: "2026-08-28T10:00:00.000Z",
        createdAt: "2026-08-28T09:00:00.000Z",
      },
    ]);
    assert.equal(sorted[0]?.id, "new");
  });

  it("refreshes drafts after compose persistence and clears seed on close", () => {
    assert.match(shell, /handleComposeDraftPersisted/);
    assert.match(shell, /void workspace\.refreshDrafts\(\)/);
    assert.match(shell, /setComposeSeed\(undefined\)/);
  });

  it("opens drafts in compose without entering reading focus", () => {
    assert.match(desktop, /mailFolder === "drafts"/);
    assert.match(desktop, /if \(mailFolder === "drafts"\) \{\s*return;\s*\}/);
    assert.match(shell, /workspace\.selectedFolder === "drafts"/);
  });
});

describe("embedded expanded compose", () => {
  const desktop = read("../../../components/mail/prototype/mail-desktop-workspace.tsx");
  const host = read("../../../components/mail/compose/mail-compose-desktop-host.tsx");

  it("keeps one compose editor mounted in a desktop host that switches layout only", () => {
    assert.match(desktop, /showEmbeddedCompose = composeOpen && composeExpanded/);
    assert.match(desktop, /mail-main-content-pane[\s\S]*mainContentPaneRef=\{mainContentPaneRef\}/);
    assert.match(host, /data-compose-host=\{expanded \? "embedded" : "floating"\}/);
    assert.doesNotMatch(desktop, /MailFloatingComposePortal/);
  });

  it("restores prior mail content state on restore/close", () => {
    assert.match(desktop, /mailContentSnapshotRef/);
    assert.match(desktop, /handleToggleComposeExpand/);
    assert.match(desktop, /handleCloseCompose/);
  });
});
