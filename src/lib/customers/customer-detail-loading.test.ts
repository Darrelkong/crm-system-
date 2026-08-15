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

function readCustomerDetailNavLinkSource(): string {
  return readFileSync(
    "src/components/customers/customer-detail-nav-link.tsx",
    "utf8",
  );
}

describe("customer detail Phase 2B5 loading boundary", () => {
  it("keeps dedicated loading.tsx for customer detail and adds hub list loading", () => {
    assert.equal(
      existsSync("src/app/(dashboard)/customers/[id]/loading.tsx"),
      true,
    );
    assert.equal(
      existsSync("src/app/(dashboard)/customers/loading.tsx"),
      true,
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
});

describe("customer detail F4 paid navigation UX", () => {
  it("uses Next Link for desktop Customer Detail navigation without prefetch=false", () => {
    const source = readCustomersListClientSource();
    const desktopBlock = source.slice(
      source.indexOf("function CustomerNameLink"),
      source.indexOf("function ProjectNameCell"),
    );
    assert.match(desktopBlock, /CustomerDetailNavLink/);
    assert.match(desktopBlock, /href=\{`\/customers\/\$\{c\.id\}`\}/);
    assert.doesNotMatch(desktopBlock, /prefetch=\{false\}/);
    assert.doesNotMatch(desktopBlock, /<a\s+href=/);
  });

  it("uses Next Link for mobile Customer Detail navigation without prefetch=false", () => {
    const source = readCustomersListClientSource();
    const mobileBlock = source.slice(
      source.indexOf("function CustomerMobileCard"),
      source.indexOf("return (\n    <div>"),
    );
    assert.match(mobileBlock, /CustomerDetailNavLink/);
    assert.match(mobileBlock, /href=\{`\/customers\/\$\{c\.id\}`\}/);
    assert.doesNotMatch(mobileBlock, /prefetch=\{false\}/);
    assert.doesNotMatch(mobileBlock, /<a\s+href=/);
  });

  it("does not add manual Customer Detail prefetch loops", () => {
    const source = readCustomersListClientSource();
    assert.doesNotMatch(source, /router\.prefetch/);
    assert.doesNotMatch(source, /IntersectionObserver/);
    assert.doesNotMatch(source, /onPointerDown=.*prefetch/);
    assert.doesNotMatch(source, /onMouseEnter=.*prefetch/);
  });

  it("wires immediate pending feedback through useLinkStatus", () => {
    const navLink = readCustomerDetailNavLinkSource();
    assert.match(navLink, /useLinkStatus/);
    assert.match(navLink, /from "next\/link"/);
    assert.match(navLink, /role="status"/);
    assert.match(navLink, /aria-live="polite"/);
    assert.match(navLink, /sr-only/);
    assert.match(navLink, /LoadingSpinner/);
  });

  it("preserves navigation perf handlers on Customer Detail links", () => {
    const source = readCustomersListClientSource();
    assert.match(source, /recordNavigationPointerDownMark/);
    assert.match(source, /recordNavigationClickMark/);
    assert.match(source, /navigationPerfHandlers=\{navigationPerfHandlers\}/);
  });
});
