import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeComposeBodyForSave,
  resolveComposeTitleKey,
  splitComposeBodyForEditor,
} from "@/lib/mail/client/compose-reply-body";

describe("compose reply body split/merge", () => {
  const quoteHtml =
    '<p>On 27 Aug 2026, Customer &lt;customer@example.com&gt; wrote:</p><blockquote><p>Original body</p></blockquote>';
  const quoteSeedHtml = `<p></p>${quoteHtml}`;

  it("splits reply body into editable and quoted sections", () => {
    const combined = `<p>My new reply</p>${quoteSeedHtml}`;
    const split = splitComposeBodyForEditor({
      bodyHtml: combined,
      composeMode: "reply",
    });
    assert.equal(split.editableHtml, "<p>My new reply</p>");
    assert.equal(split.quotedHtml, quoteHtml);
  });

  it("defaults quote collapsed with empty editable area for fresh reply seed", () => {
    const split = splitComposeBodyForEditor({
      bodyHtml: quoteSeedHtml,
      composeMode: "reply",
    });
    assert.equal(split.editableHtml, "");
    assert.match(split.quotedHtml ?? "", /wrote:/);
  });

  it("merges editable and quoted content back for save", () => {
    const merged = mergeComposeBodyForSave({
      editableHtml: "<p>Updated reply</p>",
      quotedHtml: quoteHtml,
      composeMode: "reply",
    });
    assert.equal(merged, `<p>Updated reply</p><p></p>${quoteHtml}`);
  });

  it("preserves legacy combined body when no quote marker is found", () => {
    const legacy = "<p>All in one editable block</p>";
    const split = splitComposeBodyForEditor({
      bodyHtml: legacy,
      composeMode: "reply",
    });
    assert.equal(split.editableHtml, legacy);
    assert.equal(split.quotedHtml, null);
  });

  it("resolves reply compose title key", () => {
    assert.equal(resolveComposeTitleKey("reply"), "mail.compose.reply");
    assert.equal(resolveComposeTitleKey("new"), "mail.compose.new");
  });
});
