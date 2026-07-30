import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildWorkItemsHref,
  parseWorkItemsState,
  WORK_ITEMS_DEFAULT_HREF,
  WORK_ITEMS_NOTIFICATIONS_ALL_HREF,
  WORK_ITEMS_NOTIFICATIONS_UNREAD_HREF,
} from "./url-state";
import {
  appendWorkItemsReturnTo,
  parseSafeWorkItemsReturnTo,
} from "./safe-return-to";

const root = process.cwd();
function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("work-items Round A wiring", () => {
  it("exposes /work-items route and redirects /notifications", () => {
    assert.match(read("src/app/(dashboard)/work-items/page.tsx"), /WorkItemsClient/);
    assert.match(
      read("src/app/(dashboard)/notifications/page.tsx"),
      /WORK_ITEMS_NOTIFICATIONS_ALL_HREF|tab=notifications/,
    );
    assert.match(
      read("src/app/(dashboard)/notifications/page.tsx"),
      /redirect\(/,
    );
    assert.doesNotMatch(
      read("src/app/(dashboard)/notifications/page.tsx"),
      /NotificationsPageClient/,
    );
  });

  it("updates sidebar to a single Action Center entry", () => {
    const nav = read("src/lib/layout/nav-links.ts");
    assert.match(nav, /nav\.workItems/);
    assert.match(nav, /\/work-items\?tab=tasks&view=open/);
    assert.doesNotMatch(
      nav,
      /href:\s*"\/notifications"/,
    );
    assert.match(nav, /icon:\s*"workItems"/);
  });

  it("points notification bell / mobile entry to unread notifications tab", () => {
    assert.equal(
      WORK_ITEMS_NOTIFICATIONS_UNREAD_HREF,
      "/work-items?tab=notifications&view=unread",
    );
    const mobile = read("src/lib/layout/nav-links.ts");
    assert.match(
      mobile,
      /\/work-items\?tab=notifications&view=unread/,
    );
  });

  it("parses URL state with safe fallbacks and staff scoping", () => {
    assert.deepEqual(
      parseWorkItemsState({ tab: "bogus", view: "nope" }, { role: "staff" }),
      { tab: "tasks", view: "open", staffId: null },
    );
    assert.deepEqual(
      parseWorkItemsState(
        { tab: "notifications", view: "unread" },
        { role: "staff" },
      ),
      { tab: "notifications", view: "unread", staffId: null },
    );
    const staffId = "11111111-1111-4111-8111-111111111111";
    assert.equal(
      parseWorkItemsState(
        { tab: "tasks", view: "open", staff: staffId },
        { role: "staff" },
      ).staffId,
      null,
    );
    assert.equal(
      parseWorkItemsState(
        { tab: "tasks", view: "today", staff: staffId },
        { role: "admin" },
      ).staffId,
      staffId,
    );
    // Non-RFC seed-style UUIDs used in local CRM fixtures must also work for Admin.
    assert.equal(
      parseWorkItemsState(
        {
          tab: "tasks",
          view: "open",
          staff: "11111111-1111-1111-1111-111111111102",
        },
        { role: "admin" },
      ).staffId,
      "11111111-1111-1111-1111-111111111102",
    );
    assert.equal(
      parseWorkItemsState(
        { tab: "tasks", view: "open", staff: "not-a-uuid" },
        { role: "admin" },
      ).staffId,
      null,
    );
  });

  it("builds stable work-items hrefs", () => {
    assert.equal(WORK_ITEMS_DEFAULT_HREF, "/work-items?tab=tasks&view=open");
    assert.equal(
      WORK_ITEMS_NOTIFICATIONS_ALL_HREF,
      "/work-items?tab=notifications&view=all",
    );
    assert.equal(
      buildWorkItemsHref({ tab: "tasks", view: "overdue" }),
      "/work-items?tab=tasks&view=overdue",
    );
  });

  it("safe returnTo allowlists /work-items only", () => {
    assert.equal(
      parseSafeWorkItemsReturnTo("/work-items?tab=tasks&view=today"),
      "/work-items?tab=tasks&view=today",
    );
    assert.equal(parseSafeWorkItemsReturnTo("https://evil.test/x"), null);
    assert.equal(parseSafeWorkItemsReturnTo("//evil.test"), null);
    assert.equal(parseSafeWorkItemsReturnTo("/follow-ups"), null);
    assert.equal(
      parseSafeWorkItemsReturnTo("/work-items?tab=tasks&email=a@b.com"),
      "/work-items?tab=tasks&view=open",
    );
    assert.match(
      appendWorkItemsReturnTo(
        "/customers/abc",
        "/work-items?tab=tasks&view=open",
      ),
      /returnTo=/,
    );
  });

  it("tasks query uses mutual-exclusive today/overdue and permission scope", () => {
    const q = read("src/lib/tasks/work-items-query.ts");
    assert.match(q, /gte\(schema\.tasks\.dueAt, nowIso\)/);
    assert.match(q, /lt\(schema\.tasks\.dueAt, tomorrowStart\)/);
    assert.match(q, /lt\(schema\.tasks\.dueAt, nowIso\)/);
    assert.match(q, /eq\(schema\.tasks\.assignedTo, user\.id\)/);
    assert.match(q, /COMPLETED_LIMIT/);
    assert.doesNotMatch(q, /email|phone|address/i);
  });

  it("dashboard KPI uses same exclusive today/overdue and links to work-items", () => {
    const staff = read("src/lib/reports/staff-dashboard.ts");
    const admin = read("src/lib/reports/admin-dashboard.ts");
    assert.match(staff, /gte\(schema\.tasks\.dueAt, nowIso\)/);
    assert.match(staff, /lt\(schema\.tasks\.dueAt, tomorrowStart\)/);
    assert.match(admin, /gte\(schema\.tasks\.dueAt, nowIso\)/);
    assert.match(admin, /lt\(schema\.tasks\.dueAt, tomorrowStart\)/);

    const staffUi = read("src/components/dashboard/staff-dashboard-client.tsx");
    const adminUi = read("src/components/dashboard/admin-dashboard-client.tsx");
    assert.match(staffUi, /dashboard\.todayTasks/);
    assert.match(staffUi, /\/work-items\?tab=tasks&view=today/);
    assert.match(staffUi, /\/work-items\?tab=tasks&view=overdue/);
    assert.match(adminUi, /\/work-items\?tab=tasks&view=today/);
    assert.match(adminUi, /\/work-items\?tab=tasks&view=overdue/);
  });

  it("keeps notification APIs and complete permission intact", () => {
    assert.match(
      read("src/app/api/tasks/[id]/complete/route.ts"),
      /assertCanCompleteTask/,
    );
    assert.match(
      read("src/app/api/notifications/route.ts"),
      /listNotificationsForUser/,
    );
    assert.match(
      read("src/components/dashboard/recent-notifications-card-client.tsx"),
      /\/work-items\?tab=notifications&view=all/,
    );
  });

  it("keeps i18n keys consistent across locales", () => {
    for (const locale of ["zh-Hant", "zh-Hans", "en"]) {
      const src = read(`src/i18n/locales/${locale}.ts`);
      for (const key of [
        "workItems:",
        "title:",
        "tabTasks:",
        "tabNotifications:",
        "viewOpen:",
        "viewToday:",
        "viewOverdue:",
        "viewCompleted:",
        "rolesHint:",
        "nav.workItems",
      ]) {
        if (key === "nav.workItems") {
          assert.match(src, /workItems:\s*"/);
        } else {
          assert.match(src, new RegExp(key));
        }
      }
    }
    assert.match(read("src/i18n/locales/zh-Hant.ts"), /事項中心/);
    assert.match(read("src/i18n/locales/zh-Hans.ts"), /事项中心/);
    assert.match(read("src/i18n/locales/en.ts"), /Action Center/);
  });

  it("does not modify schema, package.json, or Follow-ups Round B", () => {
    assert.doesNotMatch(read("package.json"), /recharts|ag-grid/i);
    assert.match(
      read("src/lib/follow-ups/safe-return-to.ts"),
      /parseSafeFollowUpsReturnTo/,
    );
    assert.match(
      read("drizzle/schema/tasks.ts"),
      /TASK_STATUSES = \["open", "completed", "cancelled"\]/,
    );
  });

  it("middleware allows /work-items", () => {
    const mw = read("src/middleware.ts");
    assert.match(mw, /\/work-items/);
  });
});
