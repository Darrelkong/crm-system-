import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOutboxPath,
  mapOutboxItemsResponse,
  resolveOutboxStatusLabelKey,
} from "@/lib/mail/client/mail-outbox";
import { readFileSync } from "node:fs";

describe("mail outbox client contract", () => {
  it("builds mailbox-scoped and all-accessible paths", () => {
    assert.equal(buildOutboxPath(), "/api/mail/send-operations");
    assert.equal(
      buildOutboxPath("mailbox/1"),
      "/api/mail/send-operations?mailboxId=mailbox%2F1",
    );
  });

  it("maps only supported outbox status labels", () => {
    assert.equal(resolveOutboxStatusLabelKey("pending"), "mail.outbox.waiting");
    assert.equal(
      resolveOutboxStatusLabelKey("processing"),
      "mail.outbox.sending",
    );
    assert.equal(resolveOutboxStatusLabelKey("failed"), "mail.outbox.failed");
    assert.equal(
      resolveOutboxStatusLabelKey("dispatch_uncertain"),
      "mail.outbox.uncertain",
    );
  });

  it("rejects malformed outbox responses", () => {
    assert.throws(() => mapOutboxItemsResponse({ items: null as never }));
    assert.deepEqual(mapOutboxItemsResponse({ items: [] }), []);
  });
});

describe("mail outbox architecture wiring", () => {
  it("scopes send-operation reads to existing accessible mailboxes and excludes accepted", () => {
    const service = readFileSync("src/lib/mail/outbox-service.ts", "utf8");
    assert.match(service, /listAccessibleMailboxes/);
    assert.match(service, /inArray\(schema\.mailSendOperations\.status, OUTBOX_STATUSES\)/);
    assert.match(service, /limit\(100\)/);
    assert.doesNotMatch(service, /"accepted"/);
  });

  it("keeps Outbox outside MailReadFolder and polls only the Outbox folder", () => {
    const types = readFileSync("src/lib/mail/client/mail-read-types.ts", "utf8");
    const boundary = readFileSync(
      "src/lib/mail/client/mail-workspace-data-source-boundary.tsx",
      "utf8",
    );
    assert.match(types, /MailWorkspaceFolder[\s\S]*"outbox"/);
    assert.match(types, /export type MailReadFolder = "inbox" \| "sent" \| "trash"/);
    assert.match(boundary, /workspace\.selectedFolder !== "outbox"/);
    assert.match(boundary, /setInterval\(refreshOutbox, 5_000\)/);
  });
});
