import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

function readLoadingSource(): string {
  return readFileSync(
    "src/app/(dashboard)/customers/[id]/loading.tsx",
    "utf8",
  );
}

function readCustomersListClientSource(): string {
  return readFileSync(
    "src/app/(dashboard)/customers/customers-list-client.tsx",
    "utf8",
  );
}

describe("customer detail Phase 2B5 loading boundary", () => {
  it("adds loading.tsx only for customer detail route", () => {
    assert.equal(
      existsSync("src/app/(dashboard)/customers/[id]/loading.tsx"),
      true,
    );
    assert.equal(
      existsSync("src/app/(dashboard)/customers/loading.tsx"),
      false,
    );
    assert.equal(existsSync("src/app/(dashboard)/loading.tsx"), false);
    assert.equal(existsSync("src/app/loading.tsx"), false);
  });

  it("keeps loading shell as a server component without client hooks", () => {
    const source = readLoadingSource();
    assert.doesNotMatch(source, /"use client"/);
    assert.doesNotMatch(source, /useEffect/);
    assert.doesNotMatch(source, /useState/);
    assert.doesNotMatch(source, /useLayoutEffect/);
    assert.doesNotMatch(source, /sessionStorage/);
    assert.doesNotMatch(source, /performance\./);
    assert.doesNotMatch(source, /\bfetch\(/);
    assert.doesNotMatch(source, /router\./);
  });

  it("does not access customer data or backend modules from loading shell", () => {
    const source = readLoadingSource();
    const forbidden = [
      "requireAuth",
      "getDb",
      "getCustomerById",
      "listFollowUps",
      "getCustomerTimeline",
      "enrichCustomerResponse",
      "customerName",
      "customerCode",
      "customerId",
    ];
    for (const term of forbidden) {
      assert.doesNotMatch(source, new RegExp(term));
    }
    assert.match(source, /aria-busy="true"/);
    assert.match(source, /LoadingSpinner/);
    assert.match(source, /max-w-6xl/);
  });

  it("preserves customer list navigation hrefs without prefetch changes", () => {
    const source = readCustomersListClientSource();
    assert.match(source, /href=\{`\/customers\/\$\{c\.id\}`\}/g);
    assert.doesNotMatch(source, /prefetch=/);
    assert.doesNotMatch(source, /router\.prefetch/);
  });
});
