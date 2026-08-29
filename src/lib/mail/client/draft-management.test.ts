import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  composeMobileRootClass,
  createEmptyComposeState,
  draftDetailToComposeState,
  hasMeaningfulComposeContent,
  isAuthorizedComposeSelection,
  resolveDefaultComposeOption,
  type ComposeContextOption,
} from "@/lib/mail/client/draft-management";
import { createQueuedAttachmentEntry } from "@/lib/mail/client/compose-attachment-upload";

const composeOption = (
  overrides: Partial<ComposeContextOption> = {},
): ComposeContextOption => ({
  senderIdentityId: "identity-1",
  mailboxId: "mailbox-1",
  address: "sales@example.com",
  displayName: "Sales",
  mailboxAddress: "sales@example.com",
  mailboxDisplayName: null,
  mailboxType: "personal",
  ...overrides,
});

describe("draft-management", () => {
  it("resolves default compose option from authorized list", () => {
    const options = [
      composeOption({ senderIdentityId: "a", address: "a@example.com" }),
      composeOption({ senderIdentityId: "b", address: "b@example.com" }),
    ];
    assert.equal(
      resolveDefaultComposeOption(options, { senderIdentityId: "b" })?.address,
      "b@example.com",
    );
    assert.equal(resolveDefaultComposeOption(options)?.address, "a@example.com");
  });

  it("rejects unauthorized From selections", () => {
    const options = [composeOption()];
    assert.equal(
      isAuthorizedComposeSelection(options, "identity-1", "mailbox-1"),
      true,
    );
    assert.equal(
      isAuthorizedComposeSelection(options, "identity-2", "mailbox-1"),
      false,
    );
  });

  it("detects meaningful draft content", () => {
    assert.equal(
      hasMeaningfulComposeContent({
        subject: "",
        bodyHtml: "<p></p>",
        recipientLists: { to: [], cc: [], bcc: [] },
      }),
      false,
    );
    assert.equal(
      hasMeaningfulComposeContent({
        subject: "Hello",
        bodyHtml: "",
        recipientLists: { to: [], cc: [], bcc: [] },
      }),
      true,
    );
  });

  it("restores draft detail into compose editor state", () => {
    const state = draftDetailToComposeState({
      id: "draft-1",
      authorUserId: "user-1",
      mailboxId: "mailbox-1",
      senderIdentityId: "identity-1",
      subject: "Subject",
      bodyText: "Body",
      bodyHtml: "<p>Body</p>",
      hasHtml: true,
      sensitivity: "normal",
      composeMode: "new",
      replyToMessageId: null,
      autosaveVersion: 2,
      lastSavedAt: "2026-01-01T00:00:00.000Z",
      discardedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      recipients: [
        {
          id: "recipient-1",
          recipientType: "to",
          address: "client@example.com",
          displayName: null,
          sortOrder: 0,
        },
      ],
      attachments: [],
    });
    assert.equal(state.draftId, "draft-1");
    assert.equal(state.autosaveVersion, 2);
    assert.equal(state.to[0]?.email, "client@example.com");
    assert.equal(state.bodyHtml, "<p>Body</p>");
  });

  it("tracks attachment upload UI state helpers", () => {
    const file = {
      name: "invoice.pdf",
      size: 2048,
      type: "application/pdf",
    } as File;
    const entry = createQueuedAttachmentEntry(file, (bytes) => `${bytes} B`);
    assert.equal(entry.uploadStatus, "queued");
    assert.equal(entry.name, "invoice.pdf");
  });

  it("uses distinct mobile and desktop compose root classes", () => {
    assert.match(composeMobileRootClass("embedded-mobile"), /mail-compose-mobile/);
    assert.match(composeMobileRootClass("floating-desktop"), /mail-compose-desktop/);
  });
});

describe("mail compose editor wiring", () => {
  it("renders compose shell immediately with localized sender loading", () => {
    const draftHook = readFileSync(
      "src/components/mail/compose/use-mail-compose-draft.tsx",
      "utf8",
    );
    const signature = readFileSync(
      "src/components/mail/compose/mail-compose-signature-block.tsx",
      "utf8",
    );
    const editor = readFileSync(
      "src/components/mail/compose/mail-compose-editor.tsx",
      "utf8",
    );

    assert.doesNotMatch(draftHook, /MailAdminLoadingState/);
    assert.match(draftHook, /contextLoading/);
    assert.match(signature, /MailAdmin(Loading|Error)State/);
    assert.match(editor, /embedded-mobile/);
    assert.match(editor, /floating-desktop/);
    assert.match(editor, /submitApproval/);
  });
});
