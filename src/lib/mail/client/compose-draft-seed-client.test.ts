import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createComposeDraftFromMessage,
  createComposeSeedRequestGuard,
  resolveComposeDraftSeedErrorMessageKey,
} from "@/lib/mail/client/compose-draft-seed-client";

describe("compose draft seed client", () => {
  it("posts only mode and folder to the seed endpoint", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          item: {
            id: "draft-1",
            authorUserId: "user-1",
            mailboxId: "mailbox-1",
            senderIdentityId: "identity-1",
            subject: "Re: Hello",
            bodyText: "Body",
            bodyHtml: "<p>Body</p>",
            hasHtml: true,
            sensitivity: "normal",
            composeMode: "reply",
            replyToMessageId: "message-1",
            autosaveVersion: 1,
            lastSavedAt: "2026-08-24T00:00:00.000Z",
            discardedAt: null,
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
            recipients: [],
            attachments: [],
          },
        }),
        { status: 201 },
      );
    };

    const result = await createComposeDraftFromMessage(
      {
        messageId: "message-1",
        mode: "reply_all",
        folder: "sent",
      },
      fetchImpl,
    );

    assert.equal(result.ok, true);
    assert.equal(capturedUrl, "/api/mail/messages/message-1/compose-draft");
    assert.deepEqual(capturedBody, { mode: "reply_all", folder: "sent" });
  });

  it("maps seed errors to neutral message keys", () => {
    assert.equal(
      resolveComposeDraftSeedErrorMessageKey(404),
      "mail.compose.seedDraftUnavailable",
    );
    assert.equal(
      resolveComposeDraftSeedErrorMessageKey(403),
      "mail.status.accessUnavailable",
    );
    assert.equal(
      resolveComposeDraftSeedErrorMessageKey(500),
      "mail.compose.seedDraftFailed",
    );
  });

  it("guards duplicate in-flight seed requests", () => {
    const guard = createComposeSeedRequestGuard();
    assert.equal(guard.isPending(), false);
    const first = guard.begin();
    assert.equal(guard.isPending(), true);
    const second = guard.begin();
    assert.equal(second, first + 1);
    guard.end(first);
    assert.equal(guard.isPending(), true);
    guard.end(second);
    assert.equal(guard.isPending(), false);
  });

  it("drops stale seed responses when a newer request supersedes", () => {
    const guard = createComposeSeedRequestGuard();
    const first = guard.begin();
    const second = guard.begin();
    assert.equal(guard.isCurrent(first), false);
    assert.equal(guard.isCurrent(second), true);
    guard.end(second);
    assert.equal(guard.isPending(), false);
  });
});
