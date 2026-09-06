import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getRoleNavGroups } from "@/lib/layout/nav-links";

const appNavigation = readFileSync(
  "src/components/layout/app-navigation.tsx",
  "utf8",
);
const dashboardShell = readFileSync(
  "src/components/layout/dashboard-shell.tsx",
  "utf8",
);

describe("mobile More menu navigation wiring", () => {
  it("renders the final role-filtered navigation model through MobileNavDrawer", () => {
    const systemManagement = getRoleNavGroups({ role: "admin" }).find(
      (group) => group.id === "systemManagement",
    );

    assert.deepEqual(
      systemManagement?.links.slice(0, 6).map((link) => ({
        href: link.href,
        labelKey: link.labelKey,
      })),
      [
        { href: "/admin/users", labelKey: "nav.userManagement" },
        {
          href: "/admin/public-pool-members",
          labelKey: "nav.publicPoolPermissions",
        },
        { href: "/admin/tags-stages", labelKey: "nav.tagsStages" },
        { href: "/admin/recycle-bin", labelKey: "nav.recycleBin" },
        { href: "/admin/settings", labelKey: "nav.systemSettings" },
        { href: "/help", labelKey: "nav.help" },
      ],
    );

    assert.match(
      dashboardShell,
      /const navGroups = getRoleNavGroups\(\{ role \}, pathname\);/,
    );
    assert.match(
      dashboardShell,
      /<MobileNavDrawer[\s\S]*groups=\{navGroups\}/,
    );
    assert.match(
      appNavigation,
      /<SidebarNav groups=\{groups\} onNavigate=\{onClose\} \/>/,
    );
  });

  it("does not expose Public Pool permissions to staff", () => {
    const staffHrefs = getRoleNavGroups({ role: "staff" }).flatMap((group) =>
      group.links.map((link) => link.href),
    );
    assert.equal(
      staffHrefs.includes("/admin/public-pool-members"),
      false,
    );
  });
});
