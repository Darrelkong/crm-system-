import assert from "node:assert/strict";
import { test } from "node:test";
import { mobileVisualFixtures } from "./mobile-fixtures";
import { fixtureMime } from "./fixtures";
import { parseInboundMimeBytes } from "../../src/lib/mail/inbound-mime-parser";

test("fixed sender dimensions and typography survive; the reader must not guess a redesign", async () => {
  const fixture = mobileVisualFixtures()[0];
  const parsed = await parseInboundMimeBytes(fixtureMime(fixture.name, fixture.html));
  assert.match(parsed.bodyHtmlSanitized!, /width="800"/);
  assert.match(parsed.bodyHtmlSanitized!, /font-size:48px/);
  assert.match(parsed.bodyHtmlSanitized!, /padding:24px/);
  assert.match(parsed.bodyHtmlSanitized!, /ACTUAL_END_COLUMNS/);
});

test("v6 preserves supported responsive visibility without deleting repeated content", async () => {
  const fixture = mobileVisualFixtures()[1];
  const parsed = await parseInboundMimeBytes(fixtureMime(fixture.name, fixture.html));
  assert.match(fixture.html, /@media/);
  assert.match(parsed.bodyHtmlSanitized!, /<style>/);
  assert.match(parsed.bodyHtmlSanitized!, /class="desktop"/);
  assert.match(parsed.bodyHtmlSanitized!, /@media/);
  assert.equal((parsed.bodyHtmlSanitized!.match(/Synthetic repeated link/g) ?? []).length, 2);
  assert.match(parsed.bodyHtmlSanitized!, /ACTUAL_END_VISIBILITY/);
});
