import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInboundMimeBytes } from "../../src/lib/mail/inbound-mime-parser";
import { resolveMailMessageBody } from "../../src/lib/mail/client/mail-message-body";
import { fixtureMime, readerFixtures } from "./fixtures";

for (const fixture of readerFixtures()) {
  test(`M1B ${fixture.name}: real MIME/sanitizer/resolver contract`, async () => {
    const parsed = await parseInboundMimeBytes(fixtureMime(fixture.name, fixture.html));
    const html = parsed.bodyHtmlSanitized ?? "";
    const resolved = resolveMailMessageBody({ bodyHtml: html, bodyText: parsed.bodyText });
    assert.doesNotMatch(html, /<(?:script|iframe|form|input|svg|img)\b|\son(?:click|error)=|javascript:/i);
    if (fixture.end) {
      assert.equal(resolved.mode, "html");
      assert.ok(resolved.content.includes(fixture.end));
    } else {
      // Fresh materialization now retains inert remote images. Historical v2
      // stored fixtures remain unchanged in the browser regression manifests.
      assert.equal(resolved.mode, "html");
      assert.match(html, /data-mail-image-v1=/);
    }
    if (fixture.name === "LONG_HTML") {
      assert.equal((html.match(/<p>/g) ?? []).length, 10003);
      for (const marker of ["BEGIN_LONG", "MID_LONG", "ACTUAL_END_LONG"]) assert.ok(html.includes(marker));
      assert.ok(Buffer.byteLength(html) + Buffer.byteLength(parsed.bodyText) < 1_000_000);
    }
    if (fixture.name === "QUOTED_LONG") assert.equal((html.match(/<blockquote>/g) ?? []).length, 2);
    if (fixture.name === "SAFE_WIDE_CONTENT") assert.ok(html.includes("<pre>"));
  });
}
