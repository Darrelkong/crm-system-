import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("follow-ups list return-state B1 wiring", () => {
  const client = () =>
    read("src/components/follow-ups/follow-ups-list-client.tsx");
  const helper = () => read("src/lib/follow-ups/list-return-state.ts");

  it("wires shared customer navigate save handler for mobile and desktop", () => {
    const source = client();
    assert.match(source, /onCustomerNavigateClick/);
    assert.match(source, /shouldSaveFollowUpsReturnOnNavigationClick/);
    assert.match(source, /saveFollowUpsReturnState/);
    assert.match(source, /mergeHistoryStateWithReturnMarker/);
    assert.match(source, /data-follow-up-return-id=\{item\.id\}/);
    assert.doesNotMatch(source, /preventDefault\(/);
  });

  it("restores with double rAF and behavior auto; no focus restore", () => {
    const source = client();
    assert.match(source, /requestAnimationFrame/);
    assert.match(source, /tryRestoreScroll/);
    assert.match(source, /behavior:\s*"auto"/);
    assert.match(source, /computeFollowUpsRestoreScrollY/);
    assert.doesNotMatch(source, /\.focus\(/);
    assert.doesNotMatch(source, /behavior:\s*"smooth"/);
  });

  it("strips return marker on Round A filter URL writes and scrolls to top", () => {
    const source = client();
    assert.match(source, /stripReturnMarkerFromHistoryState/);
    assert.match(source, /removeFollowUpsReturnState\(current\)/);
    assert.match(source, /scrollTo\(\{\s*top:\s*0,\s*behavior:\s*"auto"/);
  });

  it("clears return state on document reload", () => {
    const source = client();
    assert.match(source, /isDocumentReload/);
    assert.match(source, /clearFollowUpsReturnMarkerOnHistory/);
  });

  it("requires history marker or matching link-return nonce before restore", () => {
    const source = client();
    assert.match(source, /getReturnMarkerFromHistoryState/);
    assert.match(source, /buildFollowUpsReturnStorageKey/);
    assert.match(source, /markerOk/);
    assert.match(source, /linkOk/);
    assert.match(source, /getFollowUpsLinkReturnNonce/);
  });

  it("helper keeps scroll data out of history state and avoids PII fields", () => {
    const source = helper();
    assert.match(source, /__crmFollowUpsReturnKey/);
    assert.match(source, /sessionStorage/);
    assert.doesNotMatch(source, /customerName/);
    assert.doesNotMatch(source, /summary/);
    assert.doesNotMatch(source, /phone/);
    assert.doesNotMatch(source, /email/);
    assert.match(source, /FOLLOW_UPS_RETURN_TTL_MS = 30 \* 60 \* 1000/);
  });

  it("does not touch customer detail returnTo trust or SQL scope", () => {
    const detail = read(
      "src/app/(dashboard)/customers/[id]/customer-detail-client.tsx",
    );
    assert.match(detail, /href=\{returnHref\}/);
    assert.doesNotMatch(detail, /parseSafeFollowUpsReturnTo/);
    assert.doesNotMatch(detail, /router\.back/);
    const queries = read("src/lib/follow-ups/list-queries.ts");
    assert.match(queries, /where\(eq\(schema\.followUps\.userId, userId\)\)/);
    assert.doesNotMatch(queries, /ownerId/);
  });

  it("preserves Round A URL filter and debounce wiring", () => {
    const source = client();
    assert.match(source, /SEARCH_DEBOUNCE_MS = 300/);
    assert.match(source, /onCompositionStart/);
    assert.match(source, /history\.pushState/);
    assert.match(source, /history\.replaceState/);
    assert.match(source, /popstate/);
    assert.doesNotMatch(source, /fetch\(/);
    assert.doesNotMatch(source, /router\.(push|replace)/);
    assert.doesNotMatch(source, /localStorage/);
  });
});
