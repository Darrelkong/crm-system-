import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("follow-ups safe returnTo B2 wiring", () => {
  const listClient = () =>
    read("src/components/follow-ups/follow-ups-list-client.tsx");
  const detailPage = () =>
    read("src/app/(dashboard)/customers/[id]/page.tsx");
  const detailClient = () =>
    read("src/app/(dashboard)/customers/[id]/customer-detail-client.tsx");
  const safeHelper = () => read("src/lib/follow-ups/safe-return-to.ts");

  it("Mobile and Desktop customer hrefs use appendFollowUpsReturnTo", () => {
    const source = listClient();
    assert.match(source, /appendFollowUpsReturnTo/);
    assert.match(source, /buildCustomerHref/);
    assert.match(source, /customerHref=\{buildCustomerHref\(item\.customerId\)\}/);
    assert.match(source, /href=\{buildCustomerHref\(item\.customerId\)\}/);
    assert.match(source, /withFollowUpsLinkReturnNonce/);
    assert.match(source, /hasMounted/);
    assert.doesNotMatch(source, /href=\{`\/customers\/\$\{item\.customerId\}`\}/);
  });

  it("returnTo is built from current list path and excludes scroll/PII", () => {
    const source = listClient();
    assert.match(source, /buildFollowUpListHref/);
    assert.match(source, /listReturnPath/);
    assert.doesNotMatch(source, /returnTo=.*scrollY/);
    assert.doesNotMatch(source, /appendFollowUpsReturnTo\([^)]*summary/);
    assert.doesNotMatch(source, /appendFollowUpsReturnTo\([^)]*customerName/);
  });

  it("keeps B1 onCustomerNavigateClick and modifier gating", () => {
    const source = listClient();
    assert.match(source, /onCustomerNavigateClick/);
    assert.match(source, /shouldSaveFollowUpsReturnOnNavigationClick/);
    assert.match(source, /saveFollowUpsReturnState/);
    assert.match(source, /linkNonce/);
    assert.doesNotMatch(source, /preventDefault\(/);
  });

  it("reuses B1 restore with link-return nonce compatibility", () => {
    const source = listClient();
    assert.match(source, /getFollowUpsLinkReturnNonce/);
    assert.match(source, /stripFollowUpsLinkReturnNonce/);
    assert.match(source, /markerOk/);
    assert.match(source, /linkOk/);
    assert.match(source, /behavior:\s*"auto"/);
    assert.match(source, /requestAnimationFrame/);
    assert.doesNotMatch(source, /behavior:\s*"smooth"/);
    assert.doesNotMatch(source, /\.focus\(/);
  });

  it("customer detail server validates returnTo before passing returnHref", () => {
    const page = detailPage();
    assert.match(page, /parseSafeFollowUpsReturnTo/);
    assert.match(page, /safeReturnHref/);
    assert.match(page, /returnHref=\{safeReturnHref\}/);
    assert.match(page, /\?\? "\/customers"/);
    assert.doesNotMatch(page, /returnHref=\{[^}]*query\.returnTo/);
    assert.doesNotMatch(page, /returnTo=\{/);
  });

  it("customer detail back link uses returnHref without history.back", () => {
    const client = detailClient();
    assert.match(client, /returnHref: string/);
    assert.match(client, /href=\{returnHref\}/);
    assert.match(client, /customers\.backToList/);
    assert.doesNotMatch(client, /router\.back/);
    assert.doesNotMatch(client, /history\.back/);
    assert.doesNotMatch(client, /sessionStorage/);
    assert.doesNotMatch(client, /parseSafeFollowUpsReturnTo/);
  });

  it("does not add Server SQL/API or change Staff scope", () => {
    const queries = read("src/lib/follow-ups/list-queries.ts");
    assert.match(queries, /where\(eq\(schema\.followUps\.userId, userId\)\)/);
    assert.doesNotMatch(listClient(), /fetch\(/);
    assert.doesNotMatch(safeHelper(), /getDb|drizzle|SELECT /i);
    assert.doesNotMatch(detailPage(), /returnTo.*audit|INSERT /i);
  });

  it("preserves Round A filter keys and debounce wiring", () => {
    const source = listClient();
    assert.match(source, /SEARCH_DEBOUNCE_MS = 300/);
    assert.match(source, /onCompositionStart/);
    assert.match(source, /history\.pushState/);
    assert.match(source, /popstate/);
    const filters = read("src/lib/follow-ups/list-filters.ts");
    assert.match(filters, /"q"/);
    assert.match(filters, /"from"/);
    assert.match(filters, /"to"/);
    assert.match(filters, /"channel"/);
    assert.match(filters, /"staff"/);
  });
});
