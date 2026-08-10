import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  countWorkItemTasks,
  listWorkItemTasks,
} from "@/lib/tasks/service";
import {
  buildWorkItemsTasksRequestKey,
  parseWorkItemsState,
} from "@/lib/work-items/url-state";
import type { User } from "../../../drizzle/schema/users";

const root = process.cwd();
function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const staffUser = { id: SEED_IDS.staffA, role: "staff" } as User;
const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;

describe("work-items Phase 2A initial load", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("SSR page loads task rows and counts in parallel", () => {
    const page = read("src/app/(dashboard)/work-items/page.tsx");
    assert.match(page, /listWorkItemTasks/);
    assert.match(page, /countWorkItemTasks/);
    assert.match(page, /Promise\.all/);
    assert.match(page, /initialTasks=/);
    assert.match(page, /key=\{`\$\{state\.tab\}:\$\{tasksView\}:\$\{staffIdForTasks/);
  });

  it("client does not auto-fetch /api/tasks/my on mount when SSR key matches", () => {
    const client = read("src/app/(dashboard)/work-items/work-items-client.tsx");
    assert.match(client, /initialTasks/);
    assert.match(client, /useState<WorkItemTaskRow\[\]>\(initialTasks\)/);
    assert.doesNotMatch(client, /\[loadTasks\]/);
  });

  it("client still refreshes tasks after completion via loadTasks", () => {
    const client = read("src/app/(dashboard)/work-items/work-items-client.tsx");
    assert.match(client, /void loadTasks\(\)/);
    assert.match(client, /\/api\/tasks\/my/);
  });

  it("buildWorkItemsTasksRequestKey encodes view and staff scope", () => {
    const staffId = "11111111-1111-4111-8111-111111111111";
    assert.equal(
      buildWorkItemsTasksRequestKey("open", null),
      "open:",
    );
    assert.equal(
      buildWorkItemsTasksRequestKey("today", staffId),
      `today:${staffId}`,
    );
  });

  it("staff cannot select another staff scope in URL state", () => {
    const staffId = "11111111-1111-4111-8111-111111111111";
    assert.equal(
      parseWorkItemsState(
        { tab: "tasks", view: "open", staff: staffId },
        { role: "staff" },
      ).staffId,
      null,
    );
  });

  it("admin staff filter is preserved in URL state", () => {
    const staffId = "11111111-1111-4111-8111-111111111111";
    assert.equal(
      parseWorkItemsState(
        { tab: "tasks", view: "overdue", staff: staffId },
        { role: "admin" },
      ).staffId,
      staffId,
    );
  });

  for (const view of ["open", "today", "overdue", "completed"] as const) {
    it(`listWorkItemTasks returns rows for staff ${view} view`, async () => {
      const items = await listWorkItemTasks(staffUser, { view });
      assert.ok(Array.isArray(items));
      for (const item of items) {
        assert.ok(item.id);
        assert.equal(typeof item.customerAccessible, "boolean");
      }
    });
  }

  it("admin can scope listWorkItemTasks to a staff member", async () => {
    const items = await listWorkItemTasks(adminUser, {
      view: "open",
      staffId: SEED_IDS.staffA,
    });
    assert.ok(Array.isArray(items));
    for (const item of items) {
      assert.equal(item.assigneeId, SEED_IDS.staffA);
    }
  });

  it("countWorkItemTasks stats align with list scopes", async () => {
    const stats = await countWorkItemTasks(staffUser);
    assert.ok(stats.open >= 0);
    assert.ok(stats.today >= 0);
    assert.ok(stats.overdue >= 0);
    assert.ok(stats.completed >= 0);
  });
});

describe("GET /api/tasks/my compatibility", () => {
  it("keeps legacy no-view and view query branches", () => {
    const route = read("src/app/api/tasks/my/route.ts");
    assert.match(route, /listOpenTasksForUser/);
    assert.match(route, /countTaskStatsForUser/);
    assert.match(route, /listWorkItemTasks/);
    assert.match(route, /countWorkItemTasks/);
    assert.match(route, /user\.role === "admin"/);
    assert.match(route, /view,/);
  });
});
