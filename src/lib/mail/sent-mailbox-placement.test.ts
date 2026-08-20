import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailSenderIdentity } from "../../../drizzle/schema/mail-sender-identities";
import { resolveSentMaterializationMailboxId } from "@/lib/mail/sent-mailbox-placement";

function identity(
  partial: Pick<MailSenderIdentity, "defaultMailboxId" | "sentFolderMailboxId">,
): Pick<MailSenderIdentity, "defaultMailboxId" | "sentFolderMailboxId"> {
  return partial;
}

describe("resolveSentMaterializationMailboxId", () => {
  it("uses sent_folder when both default and sent_folder are set", () => {
    assert.equal(
      resolveSentMaterializationMailboxId(
        identity({ defaultMailboxId: "mailbox-a", sentFolderMailboxId: "mailbox-b" }),
      ),
      "mailbox-b",
    );
  });

  it("uses default when sent_folder is null", () => {
    assert.equal(
      resolveSentMaterializationMailboxId(
        identity({ defaultMailboxId: "mailbox-a", sentFolderMailboxId: null }),
      ),
      "mailbox-a",
    );
  });

  it("uses sent_folder when default is null (send-only identity)", () => {
    assert.equal(
      resolveSentMaterializationMailboxId(
        identity({ defaultMailboxId: null, sentFolderMailboxId: "mailbox-b" }),
      ),
      "mailbox-b",
    );
  });

  it("uses default when both reference the same mailbox", () => {
    assert.equal(
      resolveSentMaterializationMailboxId(
        identity({ defaultMailboxId: "mailbox-a", sentFolderMailboxId: "mailbox-a" }),
      ),
      "mailbox-a",
    );
  });
});
