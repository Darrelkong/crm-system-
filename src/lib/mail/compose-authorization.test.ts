import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailSenderIdentity } from "../../../drizzle/schema/mail-sender-identities";
import {
  assertSenderIdentityMailboxRelationship,
  resolveOutboundComposeMailboxId,
} from "@/lib/mail/compose-authorization";
import { MailServiceError } from "@/lib/mail/errors";

function identity(
  overrides: Partial<MailSenderIdentity>,
): MailSenderIdentity {
  return {
    id: "identity-1",
    address: "staff@example.test",
    displayName: null,
    status: "active",
    defaultMailboxId: null,
    sentFolderMailboxId: null,
    aliasOfIdentityId: null,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveOutboundComposeMailboxId", () => {
  it("returns default when present", () => {
    assert.equal(
      resolveOutboundComposeMailboxId(
        identity({ defaultMailboxId: "mailbox-a", sentFolderMailboxId: "mailbox-b" }),
      ),
      "mailbox-a",
    );
  });

  it("returns sent_folder fallback when default is null", () => {
    assert.equal(
      resolveOutboundComposeMailboxId(
        identity({ defaultMailboxId: null, sentFolderMailboxId: "mailbox-b" }),
      ),
      "mailbox-b",
    );
  });

  it("returns default when default and sent_folder are the same", () => {
    assert.equal(
      resolveOutboundComposeMailboxId(
        identity({ defaultMailboxId: "mailbox-a", sentFolderMailboxId: "mailbox-a" }),
      ),
      "mailbox-a",
    );
  });
});

describe("assertSenderIdentityMailboxRelationship", () => {
  it("allows compose through default when both mailboxes differ", () => {
    assert.doesNotThrow(() =>
      assertSenderIdentityMailboxRelationship(
        identity({ defaultMailboxId: "mailbox-a", sentFolderMailboxId: "mailbox-b" }),
        "mailbox-a",
      ),
    );
  });

  it("rejects compose through sent_folder when default exists and differs", () => {
    assert.throws(
      () =>
        assertSenderIdentityMailboxRelationship(
          identity({ defaultMailboxId: "mailbox-a", sentFolderMailboxId: "mailbox-b" }),
          "mailbox-b",
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("allows sent_folder fallback when default is null", () => {
    assert.doesNotThrow(() =>
      assertSenderIdentityMailboxRelationship(
        identity({ defaultMailboxId: null, sentFolderMailboxId: "mailbox-b" }),
        "mailbox-b",
      ),
    );
  });
});
