import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const HUB_LOADING_ROUTES = [
  "src/app/(dashboard)/admin/loading.tsx",
  "src/app/(dashboard)/staff/loading.tsx",
  "src/app/(dashboard)/customers/loading.tsx",
  "src/app/(dashboard)/work-items/loading.tsx",
  "src/app/(dashboard)/public-pool/loading.tsx",
  "src/app/(dashboard)/approvals/loading.tsx",
  "src/app/(dashboard)/follow-ups/loading.tsx",
] as const;

const CUSTOMER_DETAIL_LOADING =
  "src/app/(dashboard)/customers/[id]/loading.tsx";

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("TASK 16A hub route loading boundaries", () => {
  it("adds loading.tsx for all intended hub routes", () => {
    for (const route of HUB_LOADING_ROUTES) {
      assert.equal(existsSync(route), true, `missing ${route}`);
    }
  });

  it("keeps customer detail loading boundary unchanged", () => {
    assert.equal(existsSync(CUSTOMER_DETAIL_LOADING), true);
    const detailSource = readSource(CUSTOMER_DETAIL_LOADING);
    assert.match(detailSource, /CustomerDetailLoading/);
    assert.match(detailSource, /max-w-6xl/);
    assert.match(detailSource, /aria-busy="true"/);
    assert.doesNotMatch(detailSource, /"use client"/);
  });

  it("uses generic admin section skeleton for nested admin routes", () => {
    const adminLoading = readSource(HUB_LOADING_ROUTES[0]);
    assert.match(adminLoading, /AdminSectionLoadingSkeleton/);
    const adminSkeletonFile = readSource(
      "src/components/ui/route-loading-skeletons.tsx",
    );
    assert.match(
      adminSkeletonFile,
      /Generic admin-section skeleton for admin\/loading\.tsx/,
    );
    const adminSectionBlock = adminSkeletonFile.slice(
      adminSkeletonFile.indexOf("export function AdminSectionLoadingSkeleton"),
      adminSkeletonFile.indexOf("export function StaffDashboardLoadingSkeleton"),
    );
    assert.doesNotMatch(adminSectionBlock, /h-\[220px\]/);
    assert.doesNotMatch(adminSectionBlock, /xl:grid-cols-4/);
    assert.doesNotMatch(adminSectionBlock, /KpiCard/);
  });

  it("keeps hub loading shells as lightweight server components", () => {
    for (const route of HUB_LOADING_ROUTES) {
      const source = readSource(route);
      assert.doesNotMatch(source, /"use client"/, `${route} must stay server`);
      assert.doesNotMatch(source, /useEffect/, `${route} must not use effects`);
      assert.doesNotMatch(source, /useState/, `${route} must not use state`);
      assert.doesNotMatch(source, /\bfetch\(/, `${route} must not fetch`);
      assert.doesNotMatch(source, /requireAuth/, `${route} must not auth`);
      assert.doesNotMatch(source, /getDb/, `${route} must not query`);
    }
  });

  it("does not introduce prefetch overrides or manual prefetch", () => {
    const sources = [
      readSource("src/components/layout/app-navigation.tsx"),
      readSource("src/components/layout/mobile-bottom-nav-link.tsx"),
      readSource(
        "src/app/(dashboard)/customers/customers-list-client.tsx",
      ),
      readSource("src/components/customers/customer-detail-nav-link.tsx"),
      ...HUB_LOADING_ROUTES.map(readSource),
    ];
    for (const source of sources) {
      assert.doesNotMatch(source, /prefetch=\{false\}/);
      assert.doesNotMatch(source, /prefetch=\{true\}/);
      assert.doesNotMatch(source, /router\.prefetch/);
      assert.doesNotMatch(source, /IntersectionObserver/);
    }
  });
});

describe("TASK 16A mobile bottom navigation pending feedback", () => {
  it("wires useLinkStatus inside mobile bottom nav links", () => {
    const navLink = readSource(
      "src/components/layout/mobile-bottom-nav-link.tsx",
    );
    assert.match(navLink, /useLinkStatus/);
    assert.match(navLink, /from "next\/link"/);
    assert.match(navLink, /<Link/);
    assert.match(navLink, /role="status"/);
    assert.match(navLink, /aria-live="polite"/);
    assert.match(navLink, /sr-only/);
    assert.match(navLink, /LoadingSpinner/);
  });

  it("preserves navigation pending instrumentation in mobile bottom nav", () => {
    const navigation = readSource("src/components/layout/app-navigation.tsx");
    const mobileBlock = navigation.slice(
      navigation.indexOf("export function MobileBottomNav"),
      navigation.length,
    );
    assert.match(mobileBlock, /beginNavigationPending/);
    assert.match(mobileBlock, /MobileBottomNavLink/);
    assert.match(mobileBlock, /useNavigationPending/);
    const navLink = readSource(
      "src/components/layout/mobile-bottom-nav-link.tsx",
    );
    assert.match(navLink, /nav-item-pending/);
  });

  it("preserves desktop navigation pending instrumentation", () => {
    const navigation = readSource("src/components/layout/app-navigation.tsx");
    assert.match(navigation, /beginNavigationPending/);
    assert.match(navigation, /nav-item-pending/);
    const pending = readSource("src/components/layout/navigation-pending.tsx");
    assert.match(pending, /NavigationPendingProvider/);
    const progressBar = readSource(
      "src/components/layout/navigation-progress-bar.tsx",
    );
    assert.match(progressBar, /useIsNavigationPending/);
  });
});
