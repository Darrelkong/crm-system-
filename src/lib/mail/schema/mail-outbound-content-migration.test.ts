import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAIL_COMPOSE_MODES,
  MAIL_MESSAGE_SENSITIVITIES,
} from "../../../../drizzle/schema/mail-messages";
import { MAIL_RECIPIENT_TYPES } from "../../../../drizzle/schema/mail-message-recipients";
import { MAIL_CUSTOMER_ASSOCIATION_TYPES } from "../../../../drizzle/schema/mail-drafts";
import { MAIL_REVISION_KINDS } from "../../../../drizzle/schema/mail-outbound-revisions";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0054_mail_outbound_content.sql",
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("mail outbound content migration (static)", () => {
  // Static schema inspection does NOT replace actual SQLite/D1 constraint execution.
  it("1: defines all six outbound content tables", () => {
    const sql = migrationSql();
    for (const table of [
      "mail_drafts",
      "mail_draft_recipients",
      "mail_signature_versions",
      "mail_signature_snapshots",
      "mail_outbound_revisions",
      "mail_outbound_revision_recipients",
    ]) {
      assert.match(sql, new RegExp(`CREATE TABLE ${table}`), table);
    }
  });

  it("2: does not define is_blank on mail_drafts", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /is_blank/i);
  });

  it("3: defines draft compose modes", () => {
    const sql = migrationSql();
    const draftBlock =
      sql.match(/CREATE TABLE mail_drafts \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(draftBlock, /compose_mode TEXT NOT NULL/);
    for (const mode of MAIL_COMPOSE_MODES) {
      assert.match(draftBlock, new RegExp(`'${mode}'`));
    }
  });

  it("4: defines draft autosave_version", () => {
    const sql = migrationSql();
    assert.match(sql, /autosave_version INTEGER NOT NULL DEFAULT 0/);
    assert.match(sql, /CHECK \(autosave_version >= 0\)/);
  });

  it("5: draft recipient case-insensitive cross-type uniqueness", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_draft_recipients_draft_address[\s\S]*?lower\(address\)/,
    );
    assert.doesNotMatch(
      sql,
      /uq_mail_draft_recipients[\s\S]*?recipient_type, lower\(address\)/i,
    );
    for (const type of MAIL_RECIPIENT_TYPES) {
      assert.match(sql, new RegExp(`'${type}'`));
    }
  });

  it("6: signature version belongs to Sender Identity", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_signature_versions \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(block, /sender_identity_id TEXT NOT NULL/);
    assert.match(
      block,
      /FOREIGN KEY \(sender_identity_id\) REFERENCES mail_sender_identities \(id\)/,
    );
    assert.doesNotMatch(block, /mailbox_id/i);
    assert.doesNotMatch(block, /user_id TEXT NOT NULL/);
  });

  it("7: one active signature version per identity", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_signature_versions_active_per_identity[\s\S]*?WHERE is_active = 1/,
    );
  });

  it("8: signature snapshot has no updated_at", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_signature_snapshots \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(block, /snapshot_hash TEXT NOT NULL/);
    assert.doesNotMatch(block, /updated_at/i);
  });

  it("9: outbound revision uses generic name — not approval-specific", () => {
    const sql = migrationSql();
    assert.match(sql, /CREATE TABLE mail_outbound_revisions/);
    assert.doesNotMatch(sql, /mail_outbound_approval_revisions/i);
  });

  it("10: revision chain uniqueness", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_outbound_revisions_chain_number[\s\S]*?\(revision_chain_id, revision_number\)/,
    );
    assert.match(sql, /revision_chain_id TEXT NOT NULL/);
    assert.match(sql, /revision_number INTEGER NOT NULL/);
  });

  it("11: parent revision self-FK safety", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /FOREIGN KEY \(parent_revision_id\) REFERENCES mail_outbound_revisions \(id\)/,
    );
    assert.match(
      sql,
      /CHECK \(parent_revision_id IS NULL OR parent_revision_id != id\)/,
    );
  });

  it("E: revision_number >= 1", () => {
    const block =
      migrationSql().match(/CREATE TABLE mail_outbound_revisions \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(block, /CHECK \(revision_number >= 1\)/);
  });

  it("F: revision_number = 1 requires parent_revision_id NULL", () => {
    const block =
      migrationSql().match(/CREATE TABLE mail_outbound_revisions \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(
      block,
      /revision_number = 1 AND parent_revision_id IS NULL/,
    );
  });

  it("G: revision_number > 1 requires parent_revision_id NOT NULL", () => {
    const block =
      migrationSql().match(/CREATE TABLE mail_outbound_revisions \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(
      block,
      /revision_number > 1 AND parent_revision_id IS NOT NULL/,
    );
  });

  it("H: direct self-parent remains rejected", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CHECK \(parent_revision_id IS NULL OR parent_revision_id != id\)/,
    );
  });

  it("I: signature_snapshot_id unique per outbound revision ownership", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_outbound_revisions_signature_snapshot[\s\S]*?signature_snapshot_id\)/,
    );
    assert.match(
      sql,
      /One outbound revision owns one dedicated snapshot/i,
    );
  });

  it("J: snapshot_hash is not globally unique across snapshot rows", () => {
    const sql = migrationSql();
    assert.match(sql, /snapshot_hash is NOT globally unique/i);
    const snapBlock =
      sql.match(/CREATE TABLE mail_signature_snapshots \([\s\S]*?\);/)?.[0] ?? "";
    assert.doesNotMatch(snapBlock, /UNIQUE.*snapshot_hash/i);
  });

  it("K: recipient minimum is >=1 across To+Cc+Bcc, not To-specific", () => {
    const sql = migrationSql();
    assert.match(sql, />=1 unique recipient across To\+Cc\+Bcc/i);
    assert.match(sql, /NOT To-specific/i);
    assert.doesNotMatch(sql, /at least one To recipient/i);
    assert.doesNotMatch(sql, /To recipient required/i);
  });

  it("L: max 50 recipients remains service-layer only", () => {
    const sql = migrationSql();
    assert.match(sql, /Max 50 unique recipients: service layer only/);
    assert.doesNotMatch(sql, /CHECK.*50/i);
  });

  it("12: no approval/send/delivery state on revision", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_outbound_revisions \([\s\S]*?\);/)?.[0] ?? "";
    assert.doesNotMatch(block, /approval/i);
    assert.doesNotMatch(block, /sent_at/i);
    assert.doesNotMatch(block, /delivery/i);
    assert.doesNotMatch(block, /transport/i);
    assert.doesNotMatch(block, /updated_at/i);
  });

  it("13: revision requires Sender Identity", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_outbound_revisions \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(block, /sender_identity_id TEXT NOT NULL/);
    assert.match(block, /mailbox_id TEXT NOT NULL/);
    assert.match(block, /signature_snapshot_id TEXT NOT NULL/);
  });

  it("14: revision From snapshot fields", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_outbound_revisions \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(block, /from_address TEXT NOT NULL/);
    assert.match(block, /from_display_name TEXT/);
  });

  it("15: revision subject nonblank CHECK", () => {
    const sql = migrationSql();
    assert.match(sql, /CHECK \(length\(trim\(subject\)\) > 0\)/);
  });

  it("16: revision sanitized HTML naming/boundary", () => {
    const sql = migrationSql();
    const revBlock =
      sql.match(/CREATE TABLE mail_outbound_revisions \([\s\S]*?\);/)?.[0] ?? "";
    const draftBlock =
      sql.match(/CREATE TABLE mail_drafts \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(revBlock, /body_html_sanitized TEXT/);
    assert.match(draftBlock, /body_html TEXT/);
    assert.doesNotMatch(draftBlock, /body_html_sanitized/i);
    assert.match(
      sql,
      /body_html is WORKING COPY[\s\S]*?NOT trusted\/sanitized/i,
    );
  });

  it("17: revision recipient cross-type uniqueness", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_outbound_revision_recipients_revision_address[\s\S]*?lower\(address\)/,
    );
    assert.doesNotMatch(
      sql,
      /uq_mail_outbound_revision_recipients[\s\S]*?recipient_type, lower\(address\)/i,
    );
  });

  it("18: customer draft association consistency CHECK", () => {
    const sql = migrationSql();
    const draftBlock =
      sql.match(/CREATE TABLE mail_drafts \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(draftBlock, /customer_id TEXT/);
    for (const type of MAIL_CUSTOMER_ASSOCIATION_TYPES) {
      assert.match(draftBlock, new RegExp(`'${type}'`));
    }
    assert.match(
      draftBlock,
      /customer_id IS NULL[\s\S]*?customer_association_type IS NULL[\s\S]*?customer_associated_by_user_id IS NULL[\s\S]*?customer_associated_at IS NULL/,
    );
    assert.match(
      draftBlock,
      /customer_id IS NOT NULL[\s\S]*?customer_association_type IS NOT NULL[\s\S]*?customer_association_type IN \('auto_match', 'manual'\)[\s\S]*?customer_associated_at IS NOT NULL/,
    );
    assert.doesNotMatch(
      draftBlock,
      /customer_id IS NOT NULL[\s\S]*?customer_associated_by_user_id IS NOT NULL/,
    );
  });

  it("A: draft customer_id NULL requires all association metadata NULL", () => {
    const draftBlock =
      migrationSql().match(/CREATE TABLE mail_drafts \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(
      draftBlock,
      /\(customer_id IS NULL[\s\S]*?customer_associated_at IS NULL\)/,
    );
  });

  it("B: draft customer_id set requires type + associated_at; actor may be NULL", () => {
    const draftBlock =
      migrationSql().match(/CREATE TABLE mail_drafts \([\s\S]*?\);/)?.[0] ?? "";
    const withCustomerBranch =
      draftBlock.match(
        /\(customer_id IS NOT NULL[\s\S]*?customer_associated_at IS NOT NULL\)/,
      )?.[0] ?? "";
    assert.ok(withCustomerBranch.length > 0);
    assert.match(withCustomerBranch, /customer_association_type IS NOT NULL/);
    assert.doesNotMatch(
      withCustomerBranch,
      /customer_associated_by_user_id IS NOT NULL/,
    );
  });

  it("C: revision customer association follows same rules as draft", () => {
    const revBlock =
      migrationSql().match(/CREATE TABLE mail_outbound_revisions \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(
      revBlock,
      /customer_id IS NULL[\s\S]*?customer_associated_at IS NULL/,
    );
    const withCustomerBranch =
      revBlock.match(
        /\(customer_id IS NOT NULL[\s\S]*?customer_associated_at IS NOT NULL\)/,
      )?.[0] ?? "";
    assert.ok(withCustomerBranch.length > 0);
    assert.match(withCustomerBranch, /customer_association_type IS NOT NULL/);
    assert.doesNotMatch(
      withCustomerBranch,
      /customer_associated_by_user_id IS NOT NULL/,
    );
  });

  it("D: customer_associated_by_user_id ON DELETE SET NULL compatible with valid association", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /customer_associated_by_user_id TEXT[\s\S]*?ON DELETE SET NULL/,
    );
    assert.match(
      sql,
      /customer_associated_by_user_id is historical attribution/i,
    );
  });

  it("19: customer association frozen on revision", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_outbound_revisions \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(block, /customer_id TEXT/);
    assert.match(block, /customer_association_type TEXT/);
    assert.match(block, /customer_associated_by_user_id TEXT/);
    assert.match(block, /customer_associated_at TEXT/);
    assert.match(
      block,
      /customer_id IS NOT NULL[\s\S]*?customer_associated_at IS NOT NULL/,
    );
  });

  it("20: customer association excluded from hash documentation", () => {
    const sql = migrationSql();
    assert.match(sql, /CRM customer association is NOT part of content_hash/i);
  });

  it("21: content_hash and hash_version exist", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_outbound_revisions \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(block, /content_hash TEXT NOT NULL/);
    assert.match(block, /hash_version INTEGER NOT NULL/);
    assert.match(block, /CHECK \(hash_version >= 1\)/);
  });

  it("22: hash contract explicitly NOT final until attachment band", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /ATTACHMENT-AWARE FINAL HASH[\s\S]*?NOT YET FROZEN/i,
    );
    assert.match(sql, /Future attachments WILL be hash inputs/i);
  });

  it("23: no destructive CASCADE on outbound content tables", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
  });

  it("24: does not insert seed data", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /INSERT INTO/i);
  });

  it("25: uses filesystem migration source only (no database bindings)", () => {
    const sql = migrationSql();
    assert.ok(sql.length > 0);
    assert.doesNotMatch(sql, /wrangler/i);
    assert.doesNotMatch(sql, /getPlatformProxy/i);
  });

  it("documents signature snapshot timing before revision hash", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /Create immutable Signature Snapshot[\s\S]*?Build immutable Outbound Revision[\s\S]*?Compute revision content hash/i,
    );
  });

  it("documents revision kinds without approval state", () => {
    const sql = migrationSql();
    for (const kind of MAIL_REVISION_KINDS) {
      assert.match(sql, new RegExp(`'${kind}'`));
    }
  });

  it("defines draft discarded_at soft discard", () => {
    const sql = migrationSql();
    assert.match(sql, /discarded_at TEXT/);
  });

  it("reuses sensitivity enum from core messages", () => {
    const sql = migrationSql();
    for (const sensitivity of MAIL_MESSAGE_SENSITIVITIES) {
      assert.match(sql, new RegExp(`'${sensitivity}'`));
    }
  });

  it("signature lineage A: revision and snapshot sender identity composite FK", () => {
    const sql = migrationSql();
    const revBlock =
      sql.match(/CREATE TABLE mail_outbound_revisions \([\s\S]*?\);/)?.[0] ?? "";
    const snapBlock =
      sql.match(/CREATE TABLE mail_signature_snapshots \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(snapBlock, /UNIQUE \(id, sender_identity_id\)/);
    assert.match(
      revBlock,
      /FOREIGN KEY \(signature_snapshot_id, sender_identity_id\)[\s\S]*?REFERENCES mail_signature_snapshots \(id, sender_identity_id\)/,
    );
  });

  it("signature lineage B: revision cannot reference snapshot from different identity structurally", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /revision\.sender_identity_id = signature_snapshot\.sender_identity_id/i,
    );
    assert.doesNotMatch(
      sql,
      /FOREIGN KEY \(signature_snapshot_id\) REFERENCES mail_signature_snapshots \(id\)(?!,)/,
    );
  });

  it("signature lineage C: snapshot source version composite FK matches sender identity", () => {
    const sql = migrationSql();
    const versionBlock =
      sql.match(/CREATE TABLE mail_signature_versions \([\s\S]*?\);/)?.[0] ?? "";
    const snapBlock =
      sql.match(/CREATE TABLE mail_signature_snapshots \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(versionBlock, /UNIQUE \(id, sender_identity_id\)/);
    assert.match(
      snapBlock,
      /FOREIGN KEY \(source_signature_version_id, sender_identity_id\)[\s\S]*?REFERENCES mail_signature_versions \(id, sender_identity_id\)/,
    );
  });

  it("signature lineage D: snapshot with NULL source_signature_version_id remains allowed", () => {
    const snapBlock =
      migrationSql().match(/CREATE TABLE mail_signature_snapshots \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(snapBlock, /source_signature_version_id TEXT/);
    assert.doesNotMatch(snapBlock, /source_signature_version_id TEXT NOT NULL/);
    assert.match(
      migrationSql(),
      /NULL source version[\s\S]*?remains allowed/i,
    );
  });

  it("signature lineage E: one-snapshot-per-revision ownership uniqueness preserved", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_outbound_revisions_signature_snapshot[\s\S]*?signature_snapshot_id\)/,
    );
  });

  it("signature lineage F: is_active=1 with retired_at NULL is valid structurally", () => {
    const block =
      migrationSql().match(/CREATE TABLE mail_signature_versions \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(block, /is_active = 1 AND retired_at IS NULL/);
  });

  it("signature lineage G: is_active=0 with retired_at NULL is structurally allowed", () => {
    const block =
      migrationSql().match(/CREATE TABLE mail_signature_versions \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(block, /\(is_active = 0\)/);
    assert.doesNotMatch(
      block,
      /is_active = 0[\s\S]*?retired_at IS NOT NULL/,
    );
  });

  it("signature lineage H: is_active=0 with retired_at timestamp is valid structurally", () => {
    const block =
      migrationSql().match(/CREATE TABLE mail_signature_versions \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(block, /retired_at TEXT/);
    assert.match(
      block,
      /\(is_active = 1 AND retired_at IS NULL\)\s+OR\s+\(is_active = 0\)/,
    );
  });

  it("signature lineage I: is_active=1 with retired_at timestamp is rejected by CHECK", () => {
    const block =
      migrationSql().match(/CREATE TABLE mail_signature_versions \([\s\S]*?\);/)?.[0] ??
      "";
    const lifecycleCheck =
      block.match(
        /CHECK \(\s*\(is_active = 1 AND retired_at IS NULL\)\s+OR\s+\(is_active = 0\)\s*\)/,
      )?.[0] ?? "";
    assert.ok(lifecycleCheck.length > 0);
    assert.doesNotMatch(lifecycleCheck, /is_active = 1[\s\S]*?retired_at IS NOT NULL/);
  });

  it("signature lineage J: from_address equality is service-layer security validation only", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /SECURITY-CRITICAL[\s\S]*?Sender Identity address MUST equal from_address/i,
    );
    assert.match(sql, /do NOT FK[\s\S]*?mail_sender_identities\.address/i);
    assert.doesNotMatch(
      sql,
      /FOREIGN KEY \(from_address\)/i,
    );
  });
});
