import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const USERS_SOURCE = readFileSync(
  new URL(
    "../../app/(dashboard)/admin/users/users-client.tsx",
    import.meta.url,
  ),
  "utf8",
);
const DASHBOARD_SOURCE = readFileSync(
  new URL(
    "../../components/dashboard/admin-dashboard-summary-client.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("Admin mobile security UX contracts", () => {
  it("uses mobile member cards and Admin-only Access detail/reset wiring", () => {
    assert.match(USERS_SOURCE, /md:hidden/);
    assert.match(USERS_SOURCE, /cloudflare_access_email/);
    assert.match(USERS_SOURCE, /access-binding/);
    assert.match(USERS_SOURCE, /device_approved_count/);
    assert.match(USERS_SOURCE, /设备授权/);
    assert.match(USERS_SOURCE, /独立验证/);
  });

  it("uses mobile cards for deleted members and keeps the table desktop-only", () => {
    assert.match(USERS_SOURCE, /formerUsers\.map\(\(u\) => \(\s*<article/);
    assert.match(USERS_SOURCE, /客户状态/);
    assert.match(USERS_SOURCE, /hidden overflow-x-auto md:block/);
  });

  it("uses four compact mobile KPI cards", () => {
    assert.match(USERS_SOURCE, /grid grid-cols-2 gap-3 md:hidden/);
    assert.match(USERS_SOURCE, /statsStaffCount/);
    assert.match(USERS_SOURCE, /statsAdminCount/);
    assert.match(USERS_SOURCE, /statsActiveEmployees/);
  });

  it("uses an integrated pending-device view with mobile actions", () => {
    assert.match(USERS_SOURCE, /view=devices/);
    assert.match(USERS_SOURCE, /PendingDevicesPanel/);
    assert.match(USERS_SOURCE, /md:hidden/);
    assert.match(USERS_SOURCE, /onAction\(item\.id, "approve"\)/);
    assert.match(USERS_SOURCE, /onAction\(item\.id, "reject"\)/);
    assert.match(USERS_SOURCE, /批准并替换/);
    assert.match(USERS_SOURCE, /设备授权/);
  });

  it("shows replacement selection and member authorization capacity", () => {
    assert.match(USERS_SOURCE, /approve-and-replace/);
    assert.match(USERS_SOURCE, /将替换以下已授权设备/);
    assert.match(USERS_SOURCE, /当前授权：/);
    assert.match(USERS_SOURCE, /建议替换/);
  });

  it("provides a compact global pending-device entry", () => {
    assert.match(
      DASHBOARD_SOURCE,
      /\/admin\/users\?view=devices&status=pending/,
    );
    assert.match(DASHBOARD_SOURCE, /pendingDeviceApprovals/);
  });
});
