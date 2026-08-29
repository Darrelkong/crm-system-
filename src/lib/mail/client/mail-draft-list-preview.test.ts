import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("draft list preview presentation", () => {
  const row = read("../../../components/mail/prototype/mail-message-row.tsx");
  const adapters = read("../../../lib/mail/client/mail-workspace-ui-adapters.ts");
  const draftService = read("../../../lib/mail/draft-service.ts");

  it("renders draft recipient and body preview on separate lines", () => {
    assert.match(row, /draftRecipientSummary \|\| t\("mail\.draft\.noRecipient"\)/);
    assert.match(row, /presentation\.preview \? \(/);
    assert.match(row, /line-clamp-1 text-xs leading-snug crm-text-secondary/);
  });

  it("derives draft preview client-side without detail fetch", () => {
    assert.match(adapters, /deriveDraftListPreview/);
    assert.match(adapters, /formatDraftRecipientSummary/);
    assert.doesNotMatch(adapters, /fetchDraftDetail/);
  });

  it("batch-loads draft recipients in listDrafts without N\+1 detail calls", () => {
    assert.match(draftService, /attachDraftListRecipients/);
    assert.match(draftService, /inArray\(schema\.mailDraftRecipients\.draftId, draftIds\)/);
    assert.doesNotMatch(draftService, /getDraft\([\s\S]*?listDrafts/);
  });
});
