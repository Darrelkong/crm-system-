import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("production mailbox and folder navigation separation", () => {
  it("keeps the production mobile folder popover folder-only", () => {
    const source = read("../../../components/mail/prototype/mail-folder-popover.tsx");

    assert.doesNotMatch(source, /workspace\.selectMailbox/);
    assert.doesNotMatch(source, /adaptAccessibleMailbox/);
    assert.match(source, /workspace\.selectFolder\(folder\.id\)/);
  });

  it("places the production mailbox context above desktop folders", () => {
    const source = read("../../../components/mail/prototype/mail-folder-nav.tsx");
    const production = source.match(
      /function ProductionMailFolderNav[\s\S]*?function PrototypeMailFolderNav/,
    )?.[0];

    assert.ok(production, "expected production folder navigation");
    assert.ok(
      production!.indexOf('<MailMailboxContext variant="desktop" />') <
        production!.indexOf('t("mail.sidebar.folders")'),
      "mailbox context must precede folder navigation",
    );
  });

  it("uses canonical mailbox IDs for selector changes", () => {
    const source = read("../../../components/mail/prototype/mail-mailbox-context.tsx");

    assert.match(source, /onSelect\(mailbox\.id\)/);
    assert.doesNotMatch(source, /onSelect\(mailbox\.address\)/);
    assert.match(source, /key=\{mailbox\.id\}/);
  });

  it("renders All Mailboxes only behind the CRM Admin capability", () => {
    const source = read("../../../components/mail/prototype/mail-mailbox-context.tsx");

    assert.match(source, /useMailSession/);
    assert.match(source, /isCrmRootAdmin && mailboxes\.length > 1/);
    assert.match(source, /workspace\.mailboxScope === "all"/);
    assert.match(source, /workspace\.selectAllMailboxes/);
  });

  it("keeps a single personal mailbox visible as a static context", () => {
    const source = read("../../../components/mail/prototype/mail-mailbox-context.tsx");

    assert.match(source, /isSinglePersonalMailbox/);
    assert.match(
      source,
      /hasMultipleMailboxes \|\| isSinglePersonalMailbox \|\| isSharedOnlyMailbox/,
    );
    assert.match(source, /hasMultipleMailboxes \? \(/);
    assert.match(source, /isSharedOnlyMailbox && variant === "desktop" \?/);
  });

  it("keeps the selector interactive only for multiple mailboxes", () => {
    const source = read("../../../components/mail/prototype/mail-mailbox-context.tsx");

    const staticContext = source.match(
      /\) : \(\s*<div[\s\S]*?<\/div>\s*\)\}/,
    )?.[0];
    assert.ok(staticContext, "expected a static single-mailbox context branch");
    assert.doesNotMatch(staticContext!, /onClick|ChevronDown/);
  });

  it("keeps the mobile mailbox context compact and inline", () => {
    const source = read("../../../components/mail/prototype/mail-mailbox-context.tsx");

    assert.match(source, /showAddress = variant === "desktop"/);
    assert.match(
      source,
      /"inline-flex min-h-8 w-fit max-w-full gap-1 rounded-md px-1\.5"/,
    );
    assert.match(source, /variant === "mobile"\s*\n\s*\? "border-b crm-border px-3 py-0"/);
    assert.match(source, /variant === "mobile"[\s\S]*"text-\[13px\] font-normal"/);
    assert.match(source, /className="h-3\.5 w-3\.5 shrink-0 crm-text-secondary"/);
    assert.doesNotMatch(source, /variant === "mobile"\s*\? "min-h-10 w-full/);
  });

  it("uses an anchored mobile mailbox popover while retaining the desktop drawer", () => {
    const source = read("../../../components/mail/prototype/mail-mailbox-context.tsx");

    assert.match(source, /variant === "mobile" \? \([\s\S]*<MailMailboxContextPopover/);
    assert.match(source, /<MailMailboxContextSheet/);
    assert.match(source, /function MailMailboxContextPopover/);
    assert.match(
      source,
      /mail-folder-popover pointer-events-auto fixed overflow-hidden rounded-xl/,
    );
    assert.match(source, /overflow-y-auto overscroll-contain/);
    assert.match(source, /100dvh - \$\{Math\.max\(\s*top,[\s\S]*6rem/);
    assert.match(source, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
    assert.doesNotMatch(
      source.match(
        /variant === "mobile" \? \([\s\S]*?onClose=\{\(\) => setSheetOpen\(false\)\}[\s\S]*?\) : \(/,
      )?.[0] ?? "",
      /QuickEntryDrawer/,
    );
  });

  it("keeps mailbox ordering, grouping, selected state, and close behavior shared", () => {
    const source = read("../../../components/mail/prototype/mail-mailbox-context.tsx");
    const options = source.match(
      /function MailMailboxContextOptions[\s\S]*?function MailMailboxContextPopover/,
    )?.[0];

    assert.ok(options, "expected shared mailbox selector options");
    assert.ok(
      options!.indexOf("showAllOption") < options!.indexOf('renderSection("mail.mailbox.personal"'),
      "All Mailboxes must precede grouped mailbox sections",
    );
    assert.match(options!, /role="menuitemradio"/);
    assert.match(options!, /aria-checked=\{allSelected\}/);
    assert.match(options!, /onSelect\(mailbox\.id\);\s*onClose\(\)/);
    assert.match(options!, /mail\.mailbox\.personal/);
    assert.match(options!, /mail\.mailbox\.shared/);
  });

  it("keeps the mailbox popover contextual without replacing global navigation", () => {
    const contextSource = read("../../../components/mail/prototype/mail-mailbox-context.tsx");
    const shellSource = read("../../../components/mail/prototype/mail-prototype-shell.tsx");
    const navigationSource = read("../../../components/layout/app-navigation.tsx");

    assert.match(contextSource, /className="fixed inset-0 z-50 pointer-events-none"/);
    assert.match(shellSource, /<MailMailboxContext variant="mobile" \/>/);
    assert.match(navigationSource, /className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40/);
    assert.doesNotMatch(contextSource, /document\.body\.style\.overflow/);
  });

  it("keeps the production path free of unsupported Archive and prototype folders", () => {
    const adapters = read("../../../lib/mail/client/mail-workspace-ui-adapters.ts");

    assert.doesNotMatch(
      adapters.match(
        /PRODUCTION_MAIL_READ_FOLDERS[\s\S]*?export type ProductionWorkflowFolder/,
      )?.[0] ?? "",
      /archive|pending|returned/i,
    );
    assert.match(adapters, /id: "inbox"/);
    assert.match(adapters, /id: "sent"/);
    assert.match(adapters, /id: "trash"/);
    assert.match(adapters, /"drafts" \| "pending_approval" \| "outbox"/);
  });
});
