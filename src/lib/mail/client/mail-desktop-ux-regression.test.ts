import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { translate } from "@/i18n/translate";
import {
  composeAttachmentRemoveMessageKey,
} from "@/lib/mail/client/compose-attachment-upload";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("desktop mail reading focus mode", () => {
  const desktop = read(
    "../../../components/mail/prototype/mail-desktop-workspace.tsx",
  );
  const shell = read("../../../components/mail/prototype/mail-prototype-shell.tsx");

  it("starts wide desktop in list-only mode", () => {
    assert.match(desktop, /useState<DesktopMailView>\("list"\)/);
    assert.match(
      desktop,
      /wideDesktopListMode =[\s\S]*desktopMailView === "list"[\s\S]*!showEmbeddedCompose/,
    );
    assert.match(
      desktop,
      /data-desktop-mail-view=\{[\s\S]*showEmbeddedCompose[\s\S]*desktopMailView[\s\S]*stackPane/,
    );
  });

  it("enters reading focus when a message is selected on wide desktop", () => {
    assert.match(
      desktop,
      /if \(readingPaneFits\) \{\s*setDesktopMailView\("message"\)/,
    );
    assert.match(desktop, /wideDesktopMessageMode/);
  });

  it("hides the message list in reading focus mode", () => {
    const messageModeBlock = desktop.match(
      /wideDesktopMessageMode \? \([\s\S]*?\) : stackPane === "list"/,
    )?.[0];
    assert.ok(messageModeBlock, "expected wide desktop message mode branch");
    assert.doesNotMatch(messageModeBlock!, /<MailMessageList/);
    assert.match(messageModeBlock!, /<MailReadingPane/);
  });

  it("provides back to message list navigation in reading focus", () => {
    assert.match(desktop, /mail\.backToMessageList/);
    assert.match(desktop, /handleBackToMessageList/);
  });

  it("resets desktop mail view when folder changes", () => {
    assert.match(
      desktop,
      /workspace\?\.selectedFolder[\s\S]*setDesktopMailView\("list"\)/,
    );
  });

  it("preserves mobile list/detail navigation", () => {
    assert.match(shell, /setMobileView\("detail"\)/);
    assert.match(shell, /mobileView === "list"/);
    assert.doesNotMatch(desktop, /setMobileView/);
  });
});

describe("desktop floating compose positioning", () => {
  const desktop = read(
    "../../../components/mail/prototype/mail-desktop-workspace.tsx",
  );
  const host = read(
    "../../../components/mail/compose/mail-compose-desktop-host.tsx",
  );

  it("renders desktop compose through a single layout host instead of remounting branches", () => {
    assert.match(desktop, /MailComposeDesktopHost/);
    assert.doesNotMatch(desktop, /MailFloatingComposePortal/);
    assert.match(host, /computeCollapsedFloatingComposeLayout/);
  });

  it("anchors collapsed compose to the browser viewport bottom-right", () => {
    const layout = read("../../../lib/mail/client/compose-floating-layout.ts");
    assert.match(layout, /position: "fixed"/);
    assert.match(layout, /right: margin/);
    assert.match(layout, /bottom: margin/);
    assert.match(host, /computeCollapsedFloatingComposeLayout/);
    assert.match(host, /mail-floating-compose fixed z-40 rounded-xl border crm-border shadow-lg/);
  });

  it("uses mail content left boundary only for horizontal sizing", () => {
    assert.match(host, /readMainContentPaneLeft/);
    assert.match(host, /getBoundingClientRect\(\)\.left/);
  });

  it("bounds expanded compose to the current workspace viewport", () => {
    assert.match(host, /absolute inset-0/);
    assert.match(desktop, /mail-main-content-pane relative flex min-h-0 min-w-0 flex-1/);
    assert.doesNotMatch(host, /inset-y-0 right-0/);
    assert.doesNotMatch(host, /left: contentLeft/);
  });

  it("keeps expanded compose body internally scrollable", () => {
    assert.match(
      read("../../../lib/mail/client/draft-management.ts"),
      /mail-compose-desktop flex h-full min-h-0 flex-col overflow-hidden/,
    );
    assert.match(
      read("../../../components/mail/compose/mail-compose-editor.tsx"),
      /mail-compose-body-scroll min-h-0 flex-1 overflow-y-auto/,
    );
  });

  it("mounts desktop compose host immediately without waiting for contentLeft null gate", () => {
    assert.doesNotMatch(host, /contentLeft === null/);
    assert.match(host, /useLayoutEffect/);
    assert.match(host, /COMPOSE_DEFAULT_CONTENT_LEFT_PX/);
  });

  it("hides pane resizers while compose is open", () => {
    assert.match(desktop, /!composeOpen \? \(\s*<MailPaneResizer/);
    assert.doesNotMatch(desktop, /pointer-events-none absolute inset-0 z-20/);
  });
});

describe("desktop compose formatting and attachment layout", () => {
  const editor = read("../../../components/mail/compose/mail-compose-editor.tsx");

  it("renders formatting toolbar directly above the body editor", () => {
    assert.match(
      editor,
      /formattingVisible \? \([\s\S]*<MailFormattingToolbar[\s\S]*mail-compose-body-editor/,
    );
  });

  it("keeps desktop formatting visible without header Aa control", () => {
    assert.match(editor, /const formattingVisible = \(isFloating && !isEmbeddedExpanded\) \|\| showFormatting/);
    assert.match(editor, /formattingVisible \? \([\s\S]*<MailFormattingToolbar/);
    assert.doesNotMatch(editor, />\s*Aa\s*</);
    assert.match(editor, /isMobile \? \([\s\S]*mail\.compose\.formatting/);
  });

  it("moves desktop attachment action to the bottom action bar", () => {
    assert.match(
      editor,
      /isFloating \? \([\s\S]*submitApproval[\s\S]*fileInputRef\.current\?\.click\(\)/,
    );
    assert.match(
      editor,
      /state\.attachments\.length > 0[\s\S]*MailComposeAttachmentList/,
    );
  });
});

describe("compose instant open loading UX", () => {
  const draftHook = read(
    "../../../components/mail/compose/use-mail-compose-draft.tsx",
  );
  const editor = read("../../../components/mail/compose/mail-compose-editor.tsx");
  const fromSelector = read(
    "../../../components/mail/compose/mail-compose-from-selector.tsx",
  );
  const shell = read("../../../components/mail/prototype/mail-prototype-shell.tsx");
  const cache = read("../../../lib/mail/client/compose-context-cache.ts");

  it("prefetches compose context when mail workspace is accessible", () => {
    assert.match(shell, /prefetchComposeContext/);
    assert.match(cache, /export function prefetchComposeContext/);
  });

  it("does not block compose shell on MailAdminLoadingState", () => {
    assert.doesNotMatch(draftHook, /MailAdminLoadingState/);
    assert.doesNotMatch(
      draftHook,
      /if \(loading\) \{\s*return \([\s\S]*MailAdminLoadingState/,
    );
  });

  it("renders compose editor body immediately behind a localized error banner only", () => {
    assert.match(editor, /MailComposeEditorBody/);
    assert.match(draftHook, /export function MailComposeDraftGate/);
    assert.doesNotMatch(draftHook, /items-center justify-center p-6/);
  });

  it("localizes sender identity loading in the From row only", () => {
    assert.match(draftHook, /contextLoading/);
    assert.match(editor, /contextLoading=\{contextLoading\}/);
    assert.match(fromSelector, /mail\.compose\.loadingFrom/);
    assert.match(fromSelector, /Loader2/);
  });

  it("seeds compose options from cached context without reopen fetch delay", () => {
    assert.match(draftHook, /getCachedComposeContext/);
    assert.match(draftHook, /setCachedComposeContext/);
  });
});

describe("attachment translation and persistence wiring", () => {
  const draftHook = read(
    "../../../components/mail/compose/use-mail-compose-draft.tsx",
  );
  const attachmentList = read(
    "../../../components/mail/compose/mail-compose-attachment-list.tsx",
  );

  it("uses canonical remove attachment translation key", () => {
    assert.match(attachmentList, /composeAttachmentRemoveMessageKey\(\)/);
    assert.doesNotMatch(attachmentList, /mail\.recipient\.remove/);
    assert.equal(
      composeAttachmentRemoveMessageKey(),
      "mail.compose.attachment.removeAttachment",
    );
  });

  for (const [locale, expected] of [
    ["en", "Remove attachment"],
    ["zh-Hans", "移除附件"],
    ["zh-Hant", "移除附件"],
  ] as const) {
    it(`resolves ${locale} remove attachment label at runtime`, () => {
      const messages = JSON.parse(
        readFileSync(`public/locales/${locale}.json`, "utf8"),
      );
      const resolved = translate(messages, composeAttachmentRemoveMessageKey());
      assert.equal(resolved, expected);
      assert.notEqual(resolved, composeAttachmentRemoveMessageKey());
    });
  }

  it("implements ensurePersistedDraft with in-flight save deduplication", () => {
    assert.match(draftHook, /const ensurePersistedDraft = useCallback/);
    assert.match(draftHook, /persistInFlightRef/);
    assert.match(draftHook, /syncStateRef/);
    assert.match(draftHook, /await ensurePersistedDraft\(\)/);
    assert.match(draftHook, /allowEmptyShell: true/);
  });

  it("eliminates raw Draft must be saved before uploading attachments", () => {
    assert.doesNotMatch(
      draftHook,
      /Draft must be saved before uploading attachments/,
    );
  });

  it("surfaces localized draft persistence failures on attachments", () => {
    assert.match(draftHook, /DRAFT_SAVE_FAILED/);
    assert.match(draftHook, /DRAFT_NOT_PERSISTED/);
    assert.match(attachmentList, /composeAttachmentUploadErrorMessageKey/);
    assert.match(attachmentList, /mail\.compose\.attachment\.uploadFailed/);
  });
});
