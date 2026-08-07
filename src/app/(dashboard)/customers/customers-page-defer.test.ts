import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pageSource = readFileSync(
  "src/app/(dashboard)/customers/page.tsx",
  "utf8",
);

describe("customers page reclaim defer architecture", () => {
  it("defers reclaim list SSR via shouldDeferCustomerListLoad", () => {
    assert.match(pageSource, /shouldDeferCustomerListLoad\(requestedSortMode/);
    assert.match(pageSource, /deferInitialListLoad=\{deferInitialListLoad\}/);
    assert.match(pageSource, /if \(!deferInitialListLoad\)/);
  });

  it("never passes reclaim_soonest literal to server list query sortMode", () => {
    assert.doesNotMatch(pageSource, /sortMode:\s*["']reclaim_soonest["']/);
    assert.match(pageSource, /sortMode:\s*initialServerSortMode/);
  });

  it("passes requested reclaim sort to client for deferred hydration", () => {
    assert.match(pageSource, /sortMode=\{requestedSortMode\}/);
  });

  it("does not persist sort cookies during page SSR", () => {
    assert.doesNotMatch(pageSource, /rememberCustomerListSortPreference/);
    assert.doesNotMatch(
      readFileSync("src/lib/customers/customer-list-sort.ts", "utf8"),
      /resolveCustomerListSortForPage[\s\S]*rememberCustomerListSortPreference/,
    );
  });
});
