import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MAIL_OUTBOUND_APPROVAL_PRIORITIES,
  MAIL_OUTBOUND_APPROVAL_REVISION_REQUIRED_EVENT_TYPES,
  MAIL_OUTBOUND_APPROVAL_STATUSES,
} from "../../../../drizzle/schema/mail-outbound-approvals";
import {
  MAIL_OUTBOUND_APPROVAL_EVENT_TYPES,
  MAIL_OUTBOUND_APPROVAL_STATE_TRANSITION_EVENT_TYPES,
} from "../../../../drizzle/schema/mail-outbound-approval-events";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0056_mail_outbound_approval.sql",
);

const FROZEN_MIGRATIONS = [
  "0052_mail_foundation.sql",
  "0053_mail_message_core.sql",
  "0054_mail_outbound_content.sql",
  "0055_mail_attachment_storage.sql",
] as const;

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function approvalTableBlock(): string {
  return (
    migrationSql().match(/CREATE TABLE mail_outbound_approvals \([\s\S]*?\);/)?.[0] ??
    ""
  );
}

function eventTableBlock(): string {
  return (
    migrationSql().match(/CREATE TABLE mail_outbound_approval_events \([\s\S]*?\);/)?.[0] ??
    ""
  );
}

function frozenMigrationSql(name: string): string {
  return readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8");
}

function frozenMigrationMtime(name: string): number {
  return statSync(join(process.cwd(), "drizzle/migrations", name)).mtimeMs;
}

describe("mail outbound approval migration (static)", () => {
  it("1: approval table exists", () => {
    assert.match(migrationSql(), /CREATE TABLE mail_outbound_approvals/);
  });

  it("2: approval event table exists", () => {
    assert.match(migrationSql(), /CREATE TABLE mail_outbound_approval_events/);
  });

  it("3: approval statuses are exact locked set", () => {
    const block = approvalTableBlock();
    assert.match(block, /CHECK \(status IN \('pending', 'returned', 'withdrawn', 'approved'\)\)/);
    assert.deepEqual([...MAIL_OUTBOUND_APPROVAL_STATUSES], [
      "pending",
      "returned",
      "withdrawn",
      "approved",
    ]);
  });

  it("4: no send or delivery status on approval", () => {
    const block = approvalTableBlock();
    for (const forbidden of [
      "sent",
      "sending",
      "failed",
      "delivered",
      "bounced",
      "delivery",
      "transport",
    ]) {
      assert.doesNotMatch(block, new RegExp(`status.*'${forbidden}'`, "i"));
      assert.doesNotMatch(block, new RegExp(`${forbidden} TEXT`, "i"));
    }
  });

  it("5: priority normal and urgent only", () => {
    const block = approvalTableBlock();
    assert.match(block, /CHECK \(priority IN \('normal', 'urgent'\)\)/);
    assert.match(block, /priority TEXT NOT NULL DEFAULT 'normal'/);
    assert.deepEqual([...MAIL_OUTBOUND_APPROVAL_PRIORITIES], ["normal", "urgent"]);
    assert.doesNotMatch(block, /bypass_approval/i);
    assert.doesNotMatch(block, /auto_approve/i);
  });

  it("6: current revision, hash, and version required", () => {
    const block = approvalTableBlock();
    assert.match(block, /current_revision_id TEXT NOT NULL/);
    assert.match(block, /current_content_hash TEXT NOT NULL/);
    assert.match(block, /current_hash_version INTEGER NOT NULL/);
    assert.match(block, /CHECK \(current_hash_version >= 1\)/);
  });

  it("7: current revision composite provenance FK", () => {
    assert.match(
      migrationSql(),
      /FOREIGN KEY \(\s*current_revision_id,\s*revision_chain_id,\s*current_content_hash,\s*current_hash_version\s*\)\s+REFERENCES mail_outbound_revisions \(\s*id,\s*revision_chain_id,\s*content_hash,\s*hash_version\s*\)/,
    );
  });

  it("8: approved revision fields nullable before approval", () => {
    const block = approvalTableBlock();
    assert.match(block, /approved_revision_id TEXT/);
    assert.doesNotMatch(block, /approved_revision_id TEXT NOT NULL/);
    assert.match(block, /approved_content_hash TEXT/);
    assert.doesNotMatch(block, /approved_content_hash TEXT NOT NULL/);
    assert.match(block, /approved_hash_version INTEGER/);
    assert.doesNotMatch(block, /approved_hash_version INTEGER NOT NULL/);
  });

  it("9: approved status requires approved revision, hash, and version", () => {
    const block = approvalTableBlock();
    assert.match(
      block,
      /status = 'approved'[\s\S]*?approved_revision_id IS NOT NULL[\s\S]*?approved_content_hash IS NOT NULL[\s\S]*?approved_hash_version IS NOT NULL/,
    );
  });

  it("10: non-approved status requires approved fields NULL", () => {
    const block = approvalTableBlock();
    assert.match(
      block,
      /status != 'approved'[\s\S]*?approved_revision_id IS NULL[\s\S]*?approved_content_hash IS NULL[\s\S]*?approved_hash_version IS NULL/,
    );
  });

  it("11: revision hash candidate keys added in 0056, not old migrations", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_outbound_revisions_id_content_hash_version[\s\S]*?\(id, content_hash, hash_version\)/,
    );
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_outbound_revisions_id_chain_hash_version[\s\S]*?\(id, revision_chain_id, content_hash, hash_version\)/,
    );
    for (const frozen of FROZEN_MIGRATIONS) {
      const frozenSql = frozenMigrationSql(frozen);
      assert.doesNotMatch(
        frozenSql,
        /uq_mail_outbound_revisions_id_content_hash_version/,
      );
      assert.doesNotMatch(
        frozenSql,
        /uq_mail_outbound_revisions_id_chain_hash_version/,
      );
    }
  });

  it("12: approval events are append-only with no updated_at", () => {
    const block = eventTableBlock();
    assert.match(block, /created_at TEXT NOT NULL/);
    assert.doesNotMatch(block, /updated_at/i);
    assert.doesNotMatch(block, /event_status/i);
  });

  it("13: approval event enum is exact locked set", () => {
    const block = eventTableBlock();
    for (const eventType of MAIL_OUTBOUND_APPROVAL_EVENT_TYPES) {
      assert.match(block, new RegExp(`'${eventType}'`));
    }
    assert.deepEqual([...MAIL_OUTBOUND_APPROVAL_EVENT_TYPES], [
      "submitted",
      "resubmitted",
      "returned",
      "withdrawn",
      "approved",
      "admin_edit",
      "reminder_sent",
    ]);
  });

  it("14: event revision and hash NULL coupling", () => {
    const block = eventTableBlock();
    assert.match(
      block,
      /revision_id IS NULL[\s\S]*?content_hash IS NULL[\s\S]*?hash_version IS NULL/,
    );
    assert.match(
      block,
      /revision_id IS NOT NULL[\s\S]*?content_hash IS NOT NULL[\s\S]*?hash_version IS NOT NULL/,
    );
  });

  it("15: event revision chain composite provenance FK", () => {
    assert.match(
      migrationSql(),
      /FOREIGN KEY \(revision_id, revision_chain_id, content_hash, hash_version\)\s+REFERENCES mail_outbound_revisions \(id, revision_chain_id, content_hash, hash_version\)/,
    );
    assert.doesNotMatch(
      migrationSql(),
      /FOREIGN KEY \(revision_id, content_hash, hash_version\)\s+REFERENCES mail_outbound_revisions \(id, content_hash, hash_version\)/,
    );
  });

  it("16: no requirement that every revision has an approval row", () => {
    const sql = migrationSql();
    assert.match(sql, /revision_kind = admin_direct[\s\S]*?does NOT create a fake Staff Approval row/i);
    assert.doesNotMatch(sql, /CREATE TRIGGER/i);
    const revisionBlock = frozenMigrationSql("0054_mail_outbound_content.sql").match(
      /CREATE TABLE mail_outbound_revisions \([\s\S]*?\);/,
    )?.[0];
    assert.ok(revisionBlock);
    assert.doesNotMatch(revisionBlock!, /approval_id/i);
  });

  it("17: workflow supports returned and resubmitted cycles", () => {
    const sql = migrationSql();
    assert.match(sql, /Returned\/withdrawn workflows may be resubmitted/i);
    assert.match(sql, /'resubmitted'/);
    assert.match(sql, /'returned'/);
    assert.match(sql, /UNIQUE INDEX uq_mail_outbound_approvals_revision_chain_id/);
  });

  it("18: reminder support without scheduler implementation", () => {
    const block = approvalTableBlock();
    assert.match(block, /next_reminder_at TEXT/);
    assert.match(migrationSql(), /reminder_sent/);
    assert.doesNotMatch(migrationSql(), /CREATE TABLE mail_reminder/i);
    assert.doesNotMatch(migrationSql(), /business-hour calculation/i);
  });

  it("19: user attribution SET NULL compatible with status checks", () => {
    const block = approvalTableBlock();
    assert.match(
      block,
      /FOREIGN KEY \(resolved_by_user_id\) REFERENCES users \(id\) ON DELETE SET NULL/,
    );
    const eventBlock = eventTableBlock();
    assert.match(
      eventBlock,
      /FOREIGN KEY \(actor_user_id\) REFERENCES users \(id\) ON DELETE SET NULL/,
    );
    assert.match(
      block,
      /status IN \('returned', 'withdrawn', 'approved'\)[\s\S]*?resolved_at IS NOT NULL/,
    );
    assert.doesNotMatch(
      block,
      /resolved_by_user_id IS NOT NULL[\s\S]*?status IN \('returned', 'withdrawn', 'approved'\)/,
    );
  });

  it("20: no CASCADE deletes", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
    assert.doesNotMatch(sql, /ON UPDATE CASCADE/i);
  });

  it("21: canonical hash recomputation security rule documented", () => {
    const sql = migrationSql();
    assert.match(sql, /SECURITY-CRITICAL/i);
    assert.match(sql, /Recompute Canonical Content Hash/i);
    assert.match(sql, /ECHFRONT-MAIL-CONTENT-V1/i);
    assert.match(sql, /do NOT trust persisted content_hash blindly/i);
  });

  it("22: CRM association change distinction documented", () => {
    const sql = migrationSql();
    assert.match(sql, /CRM customer association is NOT Canonical Hash v1 input/i);
    assert.match(sql, /still requires a NEW Revision for audit/i);
  });

  it("23: no Send Operation table", () => {
    const sql = migrationSql();
    for (const forbidden of [
      "mail_send_operations",
      "mail_send_operation",
      "mail_outbound_send",
    ]) {
      assert.doesNotMatch(sql, new RegExp(`CREATE TABLE ${forbidden}`, "i"));
    }
    assert.match(sql, /future Send Operation/i);
  });

  it("24: no Transport table", () => {
    const sql = migrationSql();
    for (const forbidden of [
      "mail_transport",
      "mail_transport_attempt",
      "mail_delivery",
      "mail_delivery_event",
    ]) {
      assert.doesNotMatch(sql, new RegExp(`CREATE TABLE ${forbidden}`, "i"));
    }
  });

  it("25: frozen migrations 0052–0055 untouched", () => {
    const migrationMtime = statSync(MIGRATION_PATH).mtimeMs;
    for (const frozen of FROZEN_MIGRATIONS) {
      const mtime = frozenMigrationMtime(frozen);
      assert.ok(
        mtime <= migrationMtime,
        `${frozen} mtime should not be newer than 0056 authoring`,
      );
    }
    assert.doesNotMatch(migrationSql(), /ALTER TABLE mail_outbound_revisions/i);
    assert.doesNotMatch(migrationSql(), /DROP TABLE/i);
  });

  it("26: no D1 execution in this phase", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /wrangler/i);
    assert.doesNotMatch(sql, /miniflare/i);
    assert.match(sql, /CREATE TABLE mail_outbound_approvals/);
  });
});

describe("mail outbound approval integrity hardening (2B.10.1 static)", () => {
  it("A: approved status requires approved tuple", () => {
    const block = approvalTableBlock();
    assert.match(
      block,
      /status = 'approved'[\s\S]*?approved_revision_id IS NOT NULL/,
    );
  });

  it("B: approved tuple must equal current tuple exactly when approved", () => {
    const block = approvalTableBlock();
    assert.match(block, /approved_revision_id = current_revision_id/);
    assert.match(block, /approved_content_hash = current_content_hash/);
    assert.match(block, /approved_hash_version = current_hash_version/);
    assert.match(
      block,
      /status != 'approved'[\s\S]*?OR[\s\S]*?approved_revision_id = current_revision_id/,
    );
  });

  it("C: mismatched current #3 + approved #2 would be structurally rejected", () => {
    const block = approvalTableBlock();
    assert.match(block, /approved_revision_id = current_revision_id/);
    assert.match(migrationSql(), /not a different revision in the chain/i);
  });

  it("D: non-approved status requires approved_* NULL", () => {
    const block = approvalTableBlock();
    assert.match(
      block,
      /status != 'approved'[\s\S]*?approved_revision_id IS NULL[\s\S]*?approved_content_hash IS NULL[\s\S]*?approved_hash_version IS NULL/,
    );
  });

  it("E: workflow_version column exists", () => {
    const block = approvalTableBlock();
    assert.match(block, /workflow_version INTEGER NOT NULL DEFAULT 1/);
  });

  it("F: workflow_version >= 1 CHECK", () => {
    const block = approvalTableBlock();
    assert.match(block, /CHECK \(workflow_version >= 1\)/);
    assert.match(migrationSql(), /optimistic concurrency/i);
    assert.match(migrationSql(), /workflow_version = N \+ 1/i);
  });

  it("G: next_reminder_at allowed for pending", () => {
    const block = approvalTableBlock();
    assert.match(block, /status = 'pending'/);
    assert.match(block, /next_reminder_at TEXT/);
    assert.match(
      block,
      /status = 'pending'[\s\S]*?OR[\s\S]*?next_reminder_at IS NULL/,
    );
  });

  it("H: next_reminder_at rejected for approved", () => {
    const block = approvalTableBlock();
    assert.match(
      block,
      /status = 'pending'[\s\S]*?OR[\s\S]*?next_reminder_at IS NULL/,
    );
    assert.match(migrationSql(), /Returned \/ withdrawn \/ approved workflows must not remain reminder-eligible/i);
  });

  it("I: next_reminder_at rejected for returned", () => {
    const block = approvalTableBlock();
    assert.match(migrationSql(), /next_reminder_at valid only while status = pending/i);
    assert.match(block, /status = 'pending'/);
    assert.match(block, /next_reminder_at IS NULL/);
  });

  it("J: next_reminder_at rejected for withdrawn", () => {
    const block = approvalTableBlock();
    assert.match(
      block,
      /CHECK \(\s*status = 'pending'\s*OR\s*next_reminder_at IS NULL\s*\)/,
    );
  });

  it("K: approval event contains revision_chain_id", () => {
    const block = eventTableBlock();
    assert.match(block, /revision_chain_id TEXT NOT NULL/);
  });

  it("L: event approval_id + revision_chain_id provenance FK exists", () => {
    assert.match(
      migrationSql(),
      /FOREIGN KEY \(approval_id, revision_chain_id\)\s+REFERENCES mail_outbound_approvals \(id, revision_chain_id\)/,
    );
    assert.match(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_outbound_approvals_id_revision_chain_id/,
    );
  });

  it("M: event revision/hash/version + chain composite FK exists", () => {
    assert.match(
      migrationSql(),
      /FOREIGN KEY \(revision_id, revision_chain_id, content_hash, hash_version\)\s+REFERENCES mail_outbound_revisions \(id, revision_chain_id, content_hash, hash_version\)/,
    );
  });

  for (const [label, eventType] of [
    ["N", "submitted"],
    ["O", "resubmitted"],
    ["P", "returned"],
    ["Q", "withdrawn"],
    ["R", "approved"],
    ["S", "admin_edit"],
  ] as const) {
    it(`${label}: ${eventType} requires revision provenance`, () => {
      const block = eventTableBlock();
      assert.match(block, new RegExp(`'${eventType}'`));
      assert.match(
        block,
        new RegExp(
          `event_type NOT IN \\([\\s\\S]*?'${eventType}'[\\s\\S]*?revision_id IS NOT NULL`,
        ),
      );
      assert.ok(
        MAIL_OUTBOUND_APPROVAL_REVISION_REQUIRED_EVENT_TYPES.includes(eventType),
      );
    });
  }

  it("T: reminder_sent may omit revision provenance", () => {
    const block = eventTableBlock();
    const sql = migrationSql();
    assert.match(block, /'reminder_sent'/);
    assert.match(sql, /reminder_sent: revision provenance MAY be NULL/i);
    assert.match(
      block,
      /event_type NOT IN \([\s\S]*?'admin_edit'[\s\S]*?\)[\s\S]*?OR[\s\S]*?revision_id IS NOT NULL/,
    );
    assert.doesNotMatch(
      block,
      /event_type NOT IN \([\s\S]*?'reminder_sent'/,
    );
  });

  it("U: partial event revision tuple is rejected", () => {
    const block = eventTableBlock();
    assert.match(
      block,
      /revision_id IS NULL[\s\S]*?content_hash IS NULL[\s\S]*?hash_version IS NULL/,
    );
    assert.match(
      block,
      /revision_id IS NOT NULL[\s\S]*?content_hash IS NOT NULL[\s\S]*?hash_version IS NOT NULL/,
    );
  });

  it("V: workflow mutation + event atomicity requirement documented", () => {
    const sql = migrationSql();
    assert.match(sql, /D1 batch atomicity/i);
    assert.match(sql, /env\.DB\.batch/);
    assert.match(sql, /CAS UPDATE mail_outbound_approvals/i);
    assert.match(sql, /approved v5 \+ Event v5/i);
  });

  it("W: no Send Operation / Transport / Delivery tables introduced", () => {
    const sql = migrationSql();
    for (const forbidden of [
      "mail_send_operation",
      "mail_transport",
      "mail_delivery",
      "mail_delivery_event",
    ]) {
      assert.doesNotMatch(sql, new RegExp(`CREATE TABLE ${forbidden}`, "i"));
    }
  });

  it("X: 0052–0055 unchanged and 0057 not created", () => {
    for (const frozen of FROZEN_MIGRATIONS) {
      assert.doesNotMatch(frozenMigrationSql(frozen), /mail_outbound_approvals/);
      assert.doesNotMatch(frozenMigrationSql(frozen), /workflow_version/);
    }
    assert.doesNotMatch(migrationSql(), /0057/);
    try {
      readFileSync(join(process.cwd(), "drizzle/migrations/0057_mail_outbound_approval.sql"));
      assert.fail("0057 should not exist");
    } catch (error) {
      assert.match(String(error), /ENOENT/);
    }
  });
});

describe("mail outbound approval event workflow version (2B.10.2 static)", () => {
  it("A: approval event has workflow_version column", () => {
    const block = eventTableBlock();
    assert.match(block, /workflow_version INTEGER NOT NULL/);
  });

  it("B: event workflow_version is NOT NULL", () => {
    const block = eventTableBlock();
    assert.match(block, /workflow_version INTEGER NOT NULL/);
    assert.doesNotMatch(block, /workflow_version INTEGER,/);
  });

  it("C: event workflow_version >= 1 CHECK", () => {
    const block = eventTableBlock();
    assert.match(block, /CHECK \(workflow_version >= 1\)/);
  });

  it("D: state-transition events protected by one event per approval + workflow_version", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_outbound_approval_events_transition_per_version[\s\S]*?\(approval_id, workflow_version\)/,
    );
    for (const eventType of MAIL_OUTBOUND_APPROVAL_STATE_TRANSITION_EVENT_TYPES) {
      assert.match(sql, new RegExp(`'${eventType}'`));
    }
  });

  it("E: duplicate approved transition at same approval/version structurally rejected", () => {
    const sql = migrationSql();
    assert.match(sql, /stale competing transition cannot also claim N\+1/i);
    assert.match(sql, /SECOND defense-in-depth/i);
    assert.match(
      sql,
      /uq_mail_outbound_approval_events_transition_per_version[\s\S]*?WHERE event_type != 'reminder_sent'/,
    );
  });

  it("F: reminder_sent excluded from transition-event uniqueness", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /WHERE event_type != 'reminder_sent'/,
    );
    assert.match(sql, /reminder_sent excluded/i);
  });

  it("G: multiple reminder_sent for same approval/version allowed by schema", () => {
    const sql = migrationSql();
    assert.match(sql, /multiple reminder_sent per same version allowed/i);
    assert.match(
      sql,
      /uq_mail_outbound_approval_events_transition_per_version[\s\S]*?WHERE event_type != 'reminder_sent'/,
    );
  });

  it("H: no FK ties event.workflow_version to mutable approval.workflow_version", () => {
    const sql = migrationSql();
    assert.match(sql, /Do NOT FK event\.workflow_version/i);
    assert.doesNotMatch(
      sql,
      /FOREIGN KEY \(workflow_version\)/i,
    );
    assert.doesNotMatch(
      sql,
      /REFERENCES mail_outbound_approvals \(workflow_version\)/i,
    );
  });

  it("I: atomic mutation + matching event version contract documented", () => {
    const sql = migrationSql();
    assert.match(sql, /workflow_version = N \+ 1/i);
    assert.match(sql, /CAS UPDATE mail_outbound_approvals/i);
    assert.match(sql, /approved v5 \+ Event v5/i);
  });

  it("J: reminder does not increment workflow version contract documented", () => {
    const sql = migrationSql();
    assert.match(sql, /reminder_sent does NOT increment Approval workflow_version/i);
    assert.match(sql, /Reminder event records CURRENT workflow_version/i);
  });

  it("K: Phase 2B.10.1 invariants remain present", () => {
    const approvalBlock = approvalTableBlock();
    const eventBlock = eventTableBlock();
    const sql = migrationSql();
    assert.match(approvalBlock, /approved_revision_id = current_revision_id/);
    assert.match(approvalBlock, /workflow_version INTEGER NOT NULL DEFAULT 1/);
    assert.match(
      approvalBlock,
      /status = 'pending'[\s\S]*?OR[\s\S]*?next_reminder_at IS NULL/,
    );
    assert.match(eventBlock, /revision_chain_id TEXT NOT NULL/);
    assert.match(
      sql,
      /FOREIGN KEY \(approval_id, revision_chain_id\)\s+REFERENCES mail_outbound_approvals/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \(revision_id, revision_chain_id, content_hash, hash_version\)/,
    );
    assert.match(sql, /env\.DB\.batch/);
    assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
    assert.doesNotMatch(eventBlock, /updated_at/i);
  });

  it("L: 0052–0055 unchanged", () => {
    for (const frozen of FROZEN_MIGRATIONS) {
      const frozenSql = frozenMigrationSql(frozen);
      assert.doesNotMatch(frozenSql, /mail_outbound_approval_events/);
      assert.doesNotMatch(
        frozenSql,
        /uq_mail_outbound_approval_events_transition_per_version/,
      );
    }
    assert.doesNotMatch(migrationSql(), /0057/);
  });
});

describe("mail outbound approval D1 CAS contract (2B.10.3 static)", () => {
  it("A: documentation does NOT claim zero-row UPDATE auto-aborts batch", () => {
    const sql = migrationSql();
    assert.match(sql, /zero-row CAS is NOT automatic batch control flow/i);
    assert.match(sql, /does NOT inherently skip later[\s\S]*?statements merely because CAS updated zero rows/i);
    assert.doesNotMatch(sql, /If CAS affects zero rows, do NOT insert/i);
    assert.doesNotMatch(sql, /zero rows, D1 does not insert/i);
  });

  it("B: workflow_version increments only for non-reminder workflow transitions", () => {
    const sql = migrationSql();
    assert.match(sql, /workflow_version changes ONLY when a workflow transition creates exactly ONE non-reminder/i);
    for (const eventType of MAIL_OUTBOUND_APPROVAL_STATE_TRANSITION_EVENT_TYPES) {
      assert.match(sql, new RegExp(eventType));
    }
  });

  it("C: each successful transition requires exactly one matching non-reminder event", () => {
    const sql = migrationSql();
    assert.match(sql, /AT MOST ONE transition event/i);
    assert.match(sql, /EXACTLY ONE per successfully committed transition/i);
    assert.match(
      sql,
      /approval\.workflow_version AFTER transition == transition_event\.workflow_version/,
    );
  });

  it("D: priority change does not increment workflow_version in V1", () => {
    const sql = migrationSql();
    assert.match(sql, /priority-only changes/i);
    assert.match(sql, /No priority_changed event in V1/i);
    assert.doesNotMatch(sql, /'priority_changed'/);
  });

  it("E: next_reminder_at change does not increment workflow_version", () => {
    const sql = migrationSql();
    assert.match(sql, /Changing next_reminder_at does NOT increment workflow_version/i);
    assert.match(sql, /scheduler metadata/i);
  });

  it("F: reminder_sent does not increment workflow_version", () => {
    const sql = migrationSql();
    assert.match(sql, /reminder_sent does NOT increment Approval workflow_version/i);
  });

  it("G: submitted Approval v1 + submitted Event v1 atomic-create documented", () => {
    const sql = migrationSql();
    assert.match(sql, /Initial submission atomic create/i);
    assert.match(sql, /INSERT Approval workflow_version = 1/i);
    assert.match(sql, /INSERT submitted Event workflow_version = 1/i);
    assert.match(sql, /never be a committed Approval v1 without its submitted Event/i);
  });

  it("H: transition partial unique remains present", () => {
    assert.match(
      migrationSql(),
      /uq_mail_outbound_approval_events_transition_per_version[\s\S]*?WHERE event_type != 'reminder_sent'/,
    );
  });

  it("I: post-batch result inspection documented as diagnostic, not sole rollback", () => {
    const sql = migrationSql();
    assert.match(sql, /POST-BATCH RESULT INSPECTION/i);
    assert.match(sql, /diagnostic \/ conflict detection ONLY/i);
    assert.match(sql, /NOT the atomic rollback guarantee/i);
    assert.match(sql, /cannot retroactively[\s\S]*?rollback/i);
  });

  it("J: D1 batch documented as transactional defense-in-depth", () => {
    const sql = migrationSql();
    assert.match(sql, /env\.DB\.batch/);
    assert.match(sql, /sequentially in ONE SQL transaction/i);
    assert.match(sql, /defense-in-depth/i);
    assert.match(sql, /Do NOT assume D1Database\.transaction\(\) exists/i);
  });

  it("K: Phase 2B.10.2 schema invariants remain present", () => {
    const approvalBlock = approvalTableBlock();
    const eventBlock = eventTableBlock();
    const sql = migrationSql();
    assert.match(approvalBlock, /workflow_version INTEGER NOT NULL DEFAULT 1/);
    assert.match(eventBlock, /workflow_version INTEGER NOT NULL/);
    assert.match(eventBlock, /revision_chain_id TEXT NOT NULL/);
    assert.match(approvalBlock, /approved_revision_id = current_revision_id/);
    assert.match(
      sql,
      /uq_mail_outbound_approval_events_transition_per_version/,
    );
    assert.match(sql, /Do NOT FK event\.workflow_version/i);
  });

  it("L: 0052–0055 unchanged", () => {
    for (const frozen of FROZEN_MIGRATIONS) {
      assert.doesNotMatch(frozenMigrationSql(frozen), /D1 batch atomicity/i);
    }
    assert.doesNotMatch(migrationSql(), /0057/);
  });
});

describe("mail outbound approval guarded CAS contract (2B.10.4 static)", () => {
  it("A: post-batch meta.changes alone is NOT atomic rollback protection", () => {
    const sql = migrationSql();
    assert.match(sql, /POST-BATCH RESULT INSPECTION \(meta\.changes, D1Result\)/i);
    assert.match(sql, /diagnostic \/ conflict detection ONLY/i);
    assert.match(sql, /NOT the atomic rollback guarantee/i);
    assert.match(sql, /inspecting changes=0 cannot retroactively/i);
  });

  it("B: transition Event INSERT must be guarded by exact post-transition Approval state", () => {
    const sql = migrationSql();
    assert.match(sql, /GUARDED transition Event INSERT/i);
    assert.match(sql, /NOT a free-standing INSERT after CAS/i);
    assert.match(sql, /exact intended POST-transition Approval row/i);
    assert.match(sql, /workflow_version = :new_version/);
    assert.match(sql, /status = :new_status/);
  });

  it("C: guarded Event INSERT derives required NOT NULL field from post-state lookup", () => {
    const sql = migrationSql();
    assert.match(sql, /Derive at least one REQUIRED NOT NULL column \(e\.g\. approval_id\)/i);
    assert.match(sql, /scalar subquery/i);
    assert.match(sql, /SELECT id FROM mail_outbound_approvals/i);
    assert.match(eventTableBlock(), /approval_id TEXT NOT NULL/);
  });

  it("D: failed post-state lookup must cause SQL constraint failure", () => {
    const sql = migrationSql();
    assert.match(sql, /subquery returns NULL → approval_id NULL/i);
    assert.match(sql, /NOT NULL constraint failure/i);
    assert.match(sql, /statement fails/i);
  });

  it("E: statement failure causes batch rollback contract is documented", () => {
    const sql = migrationSql();
    assert.match(sql, /D1 batch rolls back/i);
    assert.match(sql, /Atomic rollback MUST come from transactional/i);
    assert.match(sql, /SQL statement failure \/ constraints/i);
    assert.match(sql, /sequentially in ONE SQL transaction/i);
  });

  it("F: partial transition-event UNIQUE remains second defense-in-depth", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /uq_mail_outbound_approval_events_transition_per_version[\s\S]*?WHERE event_type != 'reminder_sent'/,
    );
    assert.match(sql, /SECOND defense-in-depth/i);
    assert.match(sql, /Do NOT describe this UNIQUE as the only stale-CAS protection/i);
  });

  it("G: all transition types require guarded transition Event semantics", () => {
    const sql = migrationSql();
    assert.match(sql, /returned, withdrawn, resubmitted, admin_edit, approved/i);
    for (const eventType of [
      "returned",
      "withdrawn",
      "resubmitted",
      "admin_edit",
      "approved",
    ] as const) {
      assert.match(sql, new RegExp(eventType));
    }
    assert.match(sql, /Approved transition: guarded post-state must include status = approved/i);
  });

  it("H: initial submitted v1 atomic rule remains", () => {
    const sql = migrationSql();
    assert.match(sql, /Initial submission atomic create/i);
    assert.match(sql, /INSERT Approval workflow_version = 1/i);
    assert.match(sql, /INSERT submitted Event workflow_version = 1/i);
    assert.match(sql, /Event FK provenance to newly created Approval/i);
    assert.match(sql, /never be a committed Approval v1 without its submitted Event/i);
  });

  it("I: reminder behavior remains outside transition CAS semantics", () => {
    const sql = migrationSql();
    assert.match(sql, /reminder_sent does NOT increment Approval workflow_version/i);
    assert.match(sql, /Reminder writes do NOT use transition CAS\/guarded pattern/i);
    assert.match(sql, /transition partial UNIQUE/i);
    assert.doesNotMatch(sql, /reminder_sent[\s\S]{0,80}GUARDED transition Event INSERT/);
  });

  it("J: no D1Database.transaction() assumption", () => {
    const sql = migrationSql();
    assert.match(sql, /Do NOT assume D1Database\.transaction\(\) exists/i);
    assert.match(sql, /Use env\.DB\.batch\(\[\.\.\.\]\) only/i);
    assert.match(sql, /not D1Database\.transaction\(\)/i);
  });

  it("K: Phase 2B.10.1–2B.10.3 schema invariants remain present", () => {
    const approvalBlock = approvalTableBlock();
    const eventBlock = eventTableBlock();
    const sql = migrationSql();
    assert.match(approvalBlock, /workflow_version INTEGER NOT NULL DEFAULT 1/);
    assert.match(eventBlock, /workflow_version INTEGER NOT NULL/);
    assert.match(eventBlock, /revision_chain_id TEXT NOT NULL/);
    assert.match(approvalBlock, /approved_revision_id = current_revision_id/);
    assert.match(sql, /next_reminder_at valid only while status = pending/i);
    assert.match(
      sql,
      /uq_mail_outbound_approval_events_transition_per_version/,
    );
    assert.match(sql, /Do NOT FK event\.workflow_version/i);
    assert.match(sql, /zero-row CAS is NOT automatic batch control flow/i);
  });

  it("L: 0052–0055 unchanged", () => {
    for (const frozen of FROZEN_MIGRATIONS) {
      assert.doesNotMatch(frozenMigrationSql(frozen), /GUARDED transition Event INSERT/i);
      assert.doesNotMatch(frozenMigrationSql(frozen), /POST-BATCH RESULT INSPECTION/i);
    }
    assert.doesNotMatch(migrationSql(), /0057/);
  });
});
