import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("production reply forward compose wiring", () => {
  it("production reading pane renders seed actions instead of send-disabled placeholder", () => {
    const source = readFileSync(
      new URL(
        "../../../components/mail/prototype/mail-production-reading-pane.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(source, /MailProductionMessageActions/);
    assert.match(source, /onSeedAction/);
    assert.match(source, /composeSeedPending/);
  });

  it("production shell calls server seed API and opens compose by draftId", () => {
    const shell = readFileSync(
      new URL(
        "../../../components/mail/prototype/mail-prototype-shell.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(shell, /createComposeDraftFromMessage/);
    assert.match(shell, /openCompose\(\{ draftId: result\.item\.id \}\)/);
    assert.match(shell, /createComposeSeedRequestGuard/);
    assert.match(shell, /composeSeedPending/);
  });

  it("prototype message actions remain on prototype detail path", () => {
    const detail = readFileSync(
      new URL(
        "../../../components/mail/prototype/mail-message-detail.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(detail, /MailMessageActions/);
    assert.match(detail, /onReply\(/);

    const readingPane = readFileSync(
      new URL(
        "../../../components/mail/prototype/mail-reading-pane.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(readingPane, /MailMessageDetail/);
    assert.match(readingPane, /MailProductionReadingPane/);
  });

  it("seed client sends only mode and folder in request body", () => {
    const client = readFileSync(
      new URL("./compose-draft-seed-client.ts", import.meta.url),
      "utf8",
    );
    assert.match(client, /mode: input\.mode/);
    assert.match(client, /folder: input\.folder/);
    assert.doesNotMatch(client, /recipients/);
    assert.doesNotMatch(client, /replyToMessageId/);
    assert.doesNotMatch(client, /bodyText/);
  });

  it("production message actions expose reply, reply all, and forward", () => {
    const actions = readFileSync(
      new URL(
        "../../../components/mail/prototype/mail-production-message-actions.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(actions, /invoke\("reply"\)/);
    assert.match(actions, /invoke\("reply_all"\)/);
    assert.match(actions, /invoke\("forward"\)/);
    assert.match(actions, /disabled=\{pending\}/);
  });
});
