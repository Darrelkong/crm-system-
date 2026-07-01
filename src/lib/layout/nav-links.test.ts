import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAdminNavGroups,
  getStaffNavGroups,
  type NavLink,
} from "@/lib/layout/nav-links";

function collectHrefs(links: NavLink[]): string[] {
  const hrefs: string[] = [];
  for (const link of links) {
    hrefs.push(link.href);
    if (link.children) {
      hrefs.push(...collectHrefs(link.children));
    }
  }
  return hrefs;
}

function allNavHrefs(role: "admin" | "staff"): string[] {
  const groups = role === "admin" ? getAdminNavGroups() : getStaffNavGroups();
  return groups.flatMap((group) => collectHrefs(group.links));
}

describe("admin audit logs navigation", () => {
  it("includes /admin/audit-logs in admin nav", () => {
    const hrefs = allNavHrefs("admin");
    assert.ok(hrefs.includes("/admin/audit-logs"));
  });

  it("does not include /admin/audit-logs in staff nav", () => {
    const hrefs = allNavHrefs("staff");
    assert.ok(!hrefs.includes("/admin/audit-logs"));
  });

  it("places audit logs near login logs in admin system settings", () => {
    const groups = getAdminNavGroups();
    const systemSettings = groups
      .flatMap((group) => group.links)
      .find((link) => link.href === "/admin/settings");
    assert.ok(systemSettings?.children);
    const childHrefs = systemSettings.children.map((child) => child.href);
    const loginIndex = childHrefs.indexOf("/admin/login-logs");
    const auditIndex = childHrefs.indexOf("/admin/audit-logs");
    assert.ok(loginIndex >= 0);
    assert.ok(auditIndex >= 0);
    assert.equal(auditIndex, loginIndex + 1);
  });
});
