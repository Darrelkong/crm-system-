import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildSignaturePreviewHtml,
  buildSignatureVersionRows,
  canManageSignatures,
  draftFromSignatureVersion,
  emptySignatureEditorDraft,
  filterManageableSignatureSenderIdentities,
  isSignatureEditorDraftValid,
  isSystemNotificationSenderAddress,
  resolveSignatureVersionRowActions,
  type SignatureVersionApiItem,
} from "@/lib/mail/client/signature-management";
import type { SenderIdentityApiItem } from "@/lib/mail/client/sender-identity-management";
import {
  MAIL_NOTIFICATION_SENDING_FROM_ADDRESS,
} from "@/lib/mail/notification-sending-domain";

function version(
  overrides: Partial<SignatureVersionApiItem> = {},
): SignatureVersionApiItem {
  return {
    id: "version-1",
    senderIdentityId: "identity-1",
    versionNumber: 1,
    bodyText: "Plain signature",
    bodyHtmlSanitized: "<p>HTML signature</p>",
    hasHtml: true,
    isActive: false,
    createdByUserId: "user-1",
    createdAt: "2026-08-22T08:00:00.000Z",
    retiredAt: null,
    retiredByUserId: null,
    ...overrides,
  };
}

function identity(
  overrides: Partial<SenderIdentityApiItem> = {},
): SenderIdentityApiItem {
  return {
    id: "identity-1",
    address: "staff@echfronthk.com",
    displayName: "Staff Sender",
    status: "active",
    defaultMailboxId: "mailbox-1",
    sentFolderMailboxId: null,
    aliasOfIdentityId: null,
    createdBy: "user-1",
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    ...overrides,
  };
}

describe("canManageSignatures", () => {
  it("returns false when signatureTemplateManagement capability is missing", () => {
    assert.equal(
      canManageSignatures({ signatureTemplateManagement: false }),
      false,
    );
  });

  it("returns true when signatureTemplateManagement capability is granted", () => {
    assert.equal(
      canManageSignatures({ signatureTemplateManagement: true }),
      true,
    );
  });
});

describe("filterManageableSignatureSenderIdentities", () => {
  it("excludes system notification identities and inactive senders", () => {
    const items = filterManageableSignatureSenderIdentities([
      identity(),
      identity({
        id: "identity-2",
        address: MAIL_NOTIFICATION_SENDING_FROM_ADDRESS,
      }),
      identity({ id: "identity-3", status: "suspended" }),
      identity({ id: "identity-4", status: "deleted" }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.address, "staff@echfronthk.com");
  });
});

describe("isSystemNotificationSenderAddress", () => {
  it("flags notification transport addresses as system-managed", () => {
    assert.equal(
      isSystemNotificationSenderAddress(MAIL_NOTIFICATION_SENDING_FROM_ADDRESS),
      true,
    );
    assert.equal(isSystemNotificationSenderAddress("staff@echfronthk.com"), false);
  });
});

describe("buildSignatureVersionRows", () => {
  it("builds sorted rows with version names and owner labels", () => {
    const rows = buildSignatureVersionRows(
      [
        version({ id: "v1", versionNumber: 1, createdByUserId: "user-1" }),
        version({
          id: "v2",
          versionNumber: 2,
          isActive: true,
          createdByUserId: "user-2",
        }),
      ],
      [
        { id: "user-1", email: "a@example.com", name: "Alice", status: "active" },
        { id: "user-2", email: "b@example.com", name: "Bob", status: "active" },
      ],
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.name, "Version 2");
    assert.equal(rows[0]?.ownerLabel, "Bob");
    assert.equal(rows[1]?.name, "Version 1");
    assert.equal(rows[1]?.ownerLabel, "Alice");
  });
});

describe("resolveSignatureVersionRowActions", () => {
  it("hides actions when management is not allowed", () => {
    const actions = resolveSignatureVersionRowActions(
      buildSignatureVersionRows([version()], [])[0]!,
      false,
    );
    assert.deepEqual(actions, { showSetDefault: false, showEdit: false });
  });

  it("shows edit and set default for inactive versions", () => {
    const actions = resolveSignatureVersionRowActions(
      buildSignatureVersionRows([version({ isActive: false })], [])[0]!,
      true,
    );
    assert.deepEqual(actions, { showSetDefault: true, showEdit: true });
  });

  it("hides set default for the active version", () => {
    const actions = resolveSignatureVersionRowActions(
      buildSignatureVersionRows([version({ isActive: true })], [])[0]!,
      true,
    );
    assert.deepEqual(actions, { showSetDefault: false, showEdit: true });
  });
});

describe("signature editor draft helpers", () => {
  it("loads drafts from existing versions", () => {
    assert.deepEqual(
      draftFromSignatureVersion(version()),
      {
        bodyText: "Plain signature",
        bodyHtml: "<p>HTML signature</p>",
      },
    );
    assert.deepEqual(emptySignatureEditorDraft(), { bodyText: "", bodyHtml: "" });
  });

  it("validates drafts require plain text or HTML content", () => {
    assert.equal(isSignatureEditorDraftValid(emptySignatureEditorDraft()), false);
    assert.equal(
      isSignatureEditorDraftValid({ bodyText: "Hello", bodyHtml: "" }),
      true,
    );
    assert.equal(
      isSignatureEditorDraftValid({ bodyText: "", bodyHtml: "<p>Hi</p>" }),
      true,
    );
  });

  it("builds preview HTML from HTML first, then escaped plain text", () => {
    assert.equal(
      buildSignaturePreviewHtml({ bodyText: "Line 1\nLine 2", bodyHtml: "" }),
      "Line 1<br />Line 2",
    );
    assert.equal(
      buildSignaturePreviewHtml({
        bodyText: "ignored",
        bodyHtml: "<p>Rich</p>",
      }),
      "<p>Rich</p>",
    );
    assert.equal(buildSignaturePreviewHtml(emptySignatureEditorDraft()), null);
  });
});

describe("signature management UI wiring", () => {
  it("registers the signature section in admin center navigation", () => {
    const navSource = readFileSync(
      "src/components/mail/admin/mail-admin-center-nav.tsx",
      "utf8",
    );
    assert.match(navSource, /signature: "mail\.adminCenter\.sections\.signature"/);
  });

  it("renders SignatureManagement in the section panel", () => {
    const panelSource = readFileSync(
      "src/components/mail/admin/mail-admin-center-section-panel.tsx",
      "utf8",
    );
    assert.match(panelSource, /section === "signature"/);
    assert.match(panelSource, /<SignatureManagement \/>/);
  });
});
