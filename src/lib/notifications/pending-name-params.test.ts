import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("notification customerName sources include nameStatus", () => {
  it("approval pending / transfer / closed-won builders pass nameStatus", () => {
    const source = read("src/lib/approvals/service.ts");
    assert.match(source, /customerNameNotificationParams/);
    assert.equal(
      (source.match(/messageParams: customerNameNotificationParams\(customer\)/g) ?? [])
        .length,
      3,
    );
    assert.match(
      source,
      /\.\.\.customerNameNotificationParams\(customer\),\s*approvalType/,
    );
  });

  it("assignee approval pending passes nameStatus", () => {
    const source = read("src/lib/customers/assignees-approval.ts");
    assert.match(source, /customerNameNotificationParams\(customer\)/);
  });

  it("reclamation warning and auto-reclaim pass nameStatus", () => {
    const source = read("src/lib/reclamation/engine.ts");
    assert.equal(
      (source.match(/customerNameNotificationParams\(customer\)/g) ?? []).length,
      2,
    );
  });

  it("pending second conversion passes nameStatus from customer", () => {
    const source = read("src/lib/notifications/pending-second-conversion.ts");
    assert.match(source, /nameStatus: customer\.nameStatus/);
    assert.match(source, /customerNameNotificationParams/);
  });

  it("backup failure notification does not invent customer nameStatus", () => {
    const source = read("src/lib/backup/notifications.ts");
    assert.doesNotMatch(source, /nameStatus/);
    assert.doesNotMatch(source, /customerName/);
  });

  it("notification UI resolves messages with locale", () => {
    const list = read(
      "src/app/(dashboard)/notifications/notifications-client.tsx",
    );
    const card = read(
      "src/components/dashboard/recent-notifications-card-client.tsx",
    );
    assert.match(list, /resolveNotificationMessage\(t, item, \{ locale \}\)/);
    assert.match(card, /resolveNotificationMessage\(t, item, \{ locale \}\)/);
  });
});
