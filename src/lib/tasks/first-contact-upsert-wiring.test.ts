import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("tasks Round B1-C1 first-contact upsert wiring", () => {
  it("exposes upsert helper with canonical ordering and no client fields", () => {
    const src = read("src/lib/tasks/first-contact.ts");
    assert.match(src, /export async function upsertFirstContactTaskForClaim/);
    assert.match(src, /eq\(schema\.tasks\.type, "first_contact"\)/);
    assert.match(src, /eq\(schema\.tasks\.status, "open"\)/);
    assert.match(src, /orderBy\(asc\(schema\.tasks\.createdAt\), asc\(schema\.tasks\.id\)\)/);
    assert.match(src, /status:\s*"cancelled"/);
    assert.match(src, /ne\(schema\.tasks\.id, canonical\.id\)/);
    assert.doesNotMatch(src, /taskIds|clientTaskId/);
    assert.doesNotMatch(src, /email|phone|address/);
  });

  it("claim uses upsert and rolls back customer+assignee on task failure", () => {
    const src = read("src/lib/public-pool/service.ts");
    assert.match(src, /upsertFirstContactTaskForClaim/);
    assert.match(src, /rollbackPoolClaimToPublicPool/);
    assert.match(src, /clearCustomerAssignees/);
    assert.match(
      src,
      /taskResult = await upsertTask\([\s\S]*?catch \(error\) \{[\s\S]*?rollbackPoolClaimToPublicPool/,
    );
    assert.match(src, /writeFirstContactTaskAuditSafe/);
    assert.match(src, /reasonCode:\s*"public_pool_claim"/);
    assert.match(src, /task\.created\.first_contact/);
    assert.match(src, /action:\s*"task\.updated"/);
    assert.match(
      src,
      /\[public-pool\] first_contact task audit write failed/,
    );
    assert.match(
      src,
      /\[public-pool\] customer\.claimed_from_pool audit write failed/,
    );
    assert.match(
      src,
      /\[public-pool\] claim rollback failed after first_contact write failure/,
    );
    assert.doesNotMatch(src, /createFirstContactTask/);
  });

  it("does not modify B1-B lifecycle cancel helper", () => {
    const src = read("src/lib/tasks/lifecycle.ts");
    assert.match(src, /buildCancelOpenTasksForCustomerStatement/);
    assert.match(src, /eq\(schema\.tasks\.status, "open"\)/);
    assert.doesNotMatch(src, /first_contact|upsertFirstContact/);
  });

  it("does not modify auto reclaim cancelOwnerOpenTasks scope", () => {
    const src = read("src/lib/reclamation/engine.ts");
    assert.match(src, /eq\(schema\.tasks\.assignedTo, previousOwnerId\)/);
    assert.match(
      src,
      /inArray\(schema\.tasks\.type, \["follow_up", "first_contact"\]\)/,
    );
    assert.doesNotMatch(src, /upsertFirstContactTaskForClaim/);
  });

  it("does not change Work Items, Dashboard, Follow-ups upsert, or complete permission", () => {
    assert.match(
      read("src/lib/tasks/service.ts"),
      /export async function upsertFollowUpTask/,
    );
    assert.match(
      read("src/lib/permissions/tasks.ts"),
      /assertCanCompleteTask/,
    );
    assert.doesNotMatch(
      read("src/app/(dashboard)/work-items/work-items-client.tsx"),
      /upsertFirstContact|first-contact/,
    );
    assert.doesNotMatch(
      read("src/lib/reports/staff-dashboard.ts"),
      /upsertFirstContact|first-contact/,
    );
    assert.doesNotMatch(
      read("src/lib/notifications/service.ts"),
      /upsertFirstContact/,
    );
  });

  it("does not modify schema or package.json dependencies surface", () => {
    assert.match(
      read("drizzle/schema/tasks.ts"),
      /TASK_TYPES = \["follow_up", "first_contact", "other"\]/,
    );
    assert.doesNotMatch(read("src/lib/tasks/first-contact.ts"), /from "lodash"/);
  });
});
