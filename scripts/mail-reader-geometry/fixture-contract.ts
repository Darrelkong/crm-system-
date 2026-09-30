/** Extend an existing manifest with expected text for these fixed ASCII fixtures.
 * Real parser/sanitizer runs first. DOM normalization (e.g. implicit tbody) is
 * deliberately not confused with message loss. The browser computes the same
 * content fingerprint in-page, avoiding tool truncation of >200k strings.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseInboundMimeBytes } from "../../src/lib/mail/inbound-mime-parser";
import { fixtureMime, readerFixtures } from "./fixtures";

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || input === output) throw new Error("Provide original manifest and distinct output path");
  const manifest = JSON.parse(readFileSync(input, "utf8"));
  for (const fixture of readerFixtures()) {
    const parsed = await parseInboundMimeBytes(fixtureMime(fixture.name, fixture.html));
    const text = (parsed.bodyHtmlSanitized ?? "").replace(/<[^>]*>/g, "").replace(/\r\n?/g, "\n");
    let hash = 2166136261;
    for (let i=0;i<text.length;i++) hash=Math.imul(hash^text.charCodeAt(i),16777619);
    const row = manifest.find((r: { name: string }) => r.name === fixture.name);
    if (!row) throw new Error("Missing fixture");
    row.textFingerprint = `${text.length}:${hash>>>0}`;
  }
  writeFileSync(output, JSON.stringify(manifest, null, 2));
}
void main();
