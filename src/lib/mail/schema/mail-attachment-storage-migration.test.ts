import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MAIL_DELIVERY_MODES,
  MAIL_SECURE_EXPIRY_DAYS,
} from "../../../../drizzle/schema/mail-draft-attachments";
import {
  MAIL_SECURITY_SCAN_STATUSES,
  MAIL_STORAGE_PROVIDERS,
} from "../../../../drizzle/schema/mail-stored-files";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0055_mail_attachment_storage.sql",
);

const FROZEN_MIGRATIONS = [
  "0052_mail_foundation.sql",
  "0053_mail_message_core.sql",
  "0054_mail_outbound_content.sql",
] as const;

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function frozenMigrationSql(name: string): string {
  return readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8");
}

describe("mail attachment storage migration (static)", () => {
  it("1: stored files table exists", () => {
    const sql = migrationSql();
    assert.match(sql, /CREATE TABLE mail_stored_files/);
    for (const col of [
      "content_hash",
      "original_filename",
      "mime_type",
      "size_bytes",
      "storage_provider",
      "storage_bucket",
      "storage_key",
      "created_by_user_id",
      "security_scan_status",
      "created_at",
    ]) {
      assert.match(sql, new RegExp(col));
    }
  });

  it("2: content_hash NOT globally unique", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_stored_files \([\s\S]*?\);/)?.[0] ?? "";
    assert.doesNotMatch(sql, /UNIQUE\s*\(\s*content_hash\s*\)/i);
    assert.doesNotMatch(block, /content_hash TEXT NOT NULL UNIQUE/i);
    assert.match(sql, /CREATE INDEX idx_mail_stored_files_content_hash/);
  });

  it("3: storage_key unique", () => {
    const sql = migrationSql();
    assert.match(sql, /CREATE UNIQUE INDEX uq_mail_stored_files_storage_key/);
  });

  it("4: no public URL columns", () => {
    const sql = migrationSql();
    for (const table of [
      "mail_stored_files",
      "mail_draft_attachments",
      "mail_outbound_revision_attachments",
      "mail_message_attachments",
      "mail_signature_version_assets",
      "mail_signature_snapshot_assets",
    ]) {
      const block =
        sql.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\);`))?.[0] ??
        "";
      for (const forbidden of [
        "public_url",
        "download_url",
        "signed_url",
        "presigned_url",
      ]) {
        assert.doesNotMatch(block, new RegExp(`${forbidden} TEXT`, "i"));
      }
    }
  });

  it("5: size >= 0", () => {
    const sql = migrationSql();
    assert.match(sql, /CHECK \(size_bytes >= 0\)/);
  });

  it("6: draft attachment table", () => {
    const sql = migrationSql();
    assert.match(sql, /CREATE TABLE mail_draft_attachments/);
    const block =
      sql.match(/CREATE TABLE mail_draft_attachments \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(block, /draft_id TEXT NOT NULL/);
    assert.match(block, /stored_file_id TEXT NOT NULL/);
    assert.match(block, /display_filename TEXT NOT NULL/);
    assert.match(block, /updated_at TEXT NOT NULL/);
    assert.doesNotMatch(block, /original_filename/);
  });

  it("7: delivery_mode enum", () => {
    const sql = migrationSql();
    for (const mode of MAIL_DELIVERY_MODES) {
      assert.match(sql, new RegExp(`'${mode}'`));
    }
    for (const table of [
      "mail_draft_attachments",
      "mail_outbound_revision_attachments",
      "mail_message_attachments",
    ]) {
      const block =
        sql.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\);`))?.[0] ??
        "";
      assert.match(block, /delivery_mode TEXT NOT NULL/);
    }
  });

  it("8: direct → secure_expiry_days NULL", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /delivery_mode = 'direct_attachment' AND secure_expiry_days IS NULL/,
    );
  });

  it("9: secure → expiry IS NOT NULL and IN 1/3/7", () => {
    const sql = migrationSql();
    assert.match(sql, /delivery_mode = 'secure_file'/);
    assert.match(sql, /secure_expiry_days IS NOT NULL/);
    for (const days of MAIL_SECURE_EXPIRY_DAYS) {
      assert.match(sql, new RegExp(String(days)));
    }
    assert.match(sql, /secure_expiry_days IN \(1, 3, 7\)/);
  });

  it("10: explicit NULL protection exists on secure_expiry_days", () => {
    const sql = migrationSql();
    const draftBlock =
      sql.match(/CREATE TABLE mail_draft_attachments \([\s\S]*?\);/)?.[0] ?? "";
    const secureBranch =
      draftBlock.match(
        /delivery_mode = 'secure_file'[\s\S]*?secure_expiry_days IN \(1, 3, 7\)/,
      )?.[0] ?? "";
    assert.match(secureBranch, /secure_expiry_days IS NOT NULL/);
    assert.doesNotMatch(
      secureBranch,
      /secure_expiry_days IN \(1, 3, 7\)[\s\S]*secure_expiry_days IS NOT NULL/,
    );
  });

  it("11: revision attachment has no updated_at", () => {
    const sql = migrationSql();
    const block =
      sql.match(
        /CREATE TABLE mail_outbound_revision_attachments \([\s\S]*?\);/,
      )?.[0] ?? "";
    assert.doesNotMatch(block, /updated_at/i);
    assert.doesNotMatch(block, /approval/i);
    assert.doesNotMatch(block, /send_state/i);
    assert.doesNotMatch(block, /delivery_state/i);
  });

  it("12: revision attachment snapshots filename/MIME/size/hash/mode/expiry", () => {
    const sql = migrationSql();
    const block =
      sql.match(
        /CREATE TABLE mail_outbound_revision_attachments \([\s\S]*?\);/,
      )?.[0] ?? "";
    for (const col of [
      "content_hash",
      "original_filename",
      "display_filename",
      "mime_type",
      "size_bytes",
      "sort_order",
      "delivery_mode",
      "secure_expiry_days",
    ]) {
      assert.match(block, new RegExp(`${col} TEXT|${col} INTEGER`));
    }
  });

  it("13: stored_file + hash provenance composite FK on revision attachments", () => {
    const sql = migrationSql();
    assert.match(sql, /UNIQUE \(id, content_hash\)/);
    assert.match(
      sql,
      /FOREIGN KEY \(stored_file_id, content_hash\)\s+REFERENCES mail_stored_files \(id, content_hash\)/,
    );
  });

  it("14: original filename not used as mutable display filename", () => {
    const sql = migrationSql();
    const storedBlock =
      sql.match(/CREATE TABLE mail_stored_files \([\s\S]*?\);/)?.[0] ?? "";
    const draftBlock =
      sql.match(/CREATE TABLE mail_draft_attachments \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(storedBlock, /original_filename TEXT NOT NULL/);
    assert.match(draftBlock, /display_filename TEXT NOT NULL/);
    assert.doesNotMatch(draftBlock, /original_filename/);
  });

  it("15: message attachments support inbound with null source revision attachment", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_message_attachments \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(block, /source_revision_attachment_id TEXT/);
    assert.doesNotMatch(block, /source_revision_attachment_id TEXT NOT NULL/);
  });

  it("16: message stored_file/hash provenance composite FK", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_message_attachments \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(
      block,
      /FOREIGN KEY \(stored_file_id, content_hash\)\s+REFERENCES mail_stored_files \(id, content_hash\)/,
    );
  });

  it("17: no global file dedup", () => {
    const sql = migrationSql();
    const storedBlock =
      sql.match(/CREATE TABLE mail_stored_files \([\s\S]*?\);/)?.[0] ?? "";
    assert.doesNotMatch(storedBlock, /reference_count/i);
    assert.doesNotMatch(sql, /UNIQUE\s*\(\s*content_hash\s*\)/i);
    assert.match(sql, /NOT globally unique/i);
  });

  it("18: no attachment stored_file uniqueness invented per parent", () => {
    const sql = migrationSql();
    assert.doesNotMatch(
      sql,
      /UNIQUE\s*\(\s*draft_id,\s*stored_file_id\s*\)/i,
    );
    assert.doesNotMatch(
      sql,
      /UNIQUE\s*\(\s*revision_id,\s*stored_file_id\s*\)/i,
    );
    assert.doesNotMatch(
      sql,
      /UNIQUE\s*\(\s*message_id,\s*stored_file_id\s*\)/i,
    );
  });

  it("19: no CASCADE", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
    assert.match(sql, /ON DELETE SET NULL/);
  });

  it("20: secure access token/url table NOT created", () => {
    const sql = migrationSql();
    for (const forbidden of [
      "mail_secure_download",
      "mail_file_access",
      "download_token",
      "access_token",
      "secure_link",
    ]) {
      assert.doesNotMatch(sql, new RegExp(`CREATE TABLE ${forbidden}`, "i"));
    }
  });

  it("21: attachment-aware fields exist for future hash", () => {
    const sql = migrationSql();
    const revBlock =
      sql.match(
        /CREATE TABLE mail_outbound_revision_attachments \([\s\S]*?\);/,
      )?.[0] ?? "";
    for (const field of [
      "content_hash",
      "display_filename",
      "mime_type",
      "size_bytes",
      "sort_order",
      "delivery_mode",
      "secure_expiry_days",
    ]) {
      assert.match(revBlock, new RegExp(field));
    }
    assert.match(sql, /Revision attachment canonical hash inputs/);
    assert.match(sql, /EXCLUDED from external hash: stored_file_id/i);
  });

  it("22: final canonical hash contract explicitly still deferred", () => {
    const sql = migrationSql();
    assert.match(sql, /CANONICAL HASH V1 ALGORITHM: NOT YET FROZEN/i);
    assert.match(sql, /hash service not implemented/i);
    assert.doesNotMatch(sql, /hash_version = 1 rules/i);
  });

  it("23: no database execution — filesystem migration source only", () => {
    const sql = migrationSql();
    assert.ok(sql.length > 0);
    assert.doesNotMatch(sql, /wrangler/i);
    assert.doesNotMatch(sql, /getPlatformProxy/i);
    assert.doesNotMatch(sql, /INSERT INTO/i);
  });

  it("24: 0052/0053/0054 unchanged — no attachment tables in frozen migrations", () => {
    for (const name of FROZEN_MIGRATIONS) {
      const sql = frozenMigrationSql(name);
      assert.doesNotMatch(sql, /CREATE TABLE mail_stored_files/);
      assert.doesNotMatch(sql, /CREATE TABLE mail_draft_attachments/);
      assert.doesNotMatch(sql, /CREATE TABLE mail_outbound_revision_attachments/);
      assert.doesNotMatch(sql, /CREATE TABLE mail_message_attachments/);
    }
    assert.ok(statSync(join(process.cwd(), "drizzle/migrations", FROZEN_MIGRATIONS[0])).isFile());
  });

  it("defines all six attachment/signature asset storage tables", () => {
    const sql = migrationSql();
    for (const table of [
      "mail_stored_files",
      "mail_draft_attachments",
      "mail_outbound_revision_attachments",
      "mail_message_attachments",
      "mail_signature_version_assets",
      "mail_signature_snapshot_assets",
    ]) {
      assert.match(sql, new RegExp(`CREATE TABLE ${table}`), table);
    }
  });

  it("security scan statuses documented without implementation", () => {
    const sql = migrationSql();
    for (const status of MAIL_SECURITY_SCAN_STATUSES) {
      assert.match(sql, new RegExp(`'${status}'`));
    }
    assert.match(sql, /scanning NOT implemented/i);
  });

  it("storage provider enum without hardcoded bucket names", () => {
    const sql = migrationSql();
    for (const provider of MAIL_STORAGE_PROVIDERS) {
      assert.match(sql, new RegExp(`'${provider}'`));
    }
    assert.doesNotMatch(sql, /crm-attachments/);
    assert.doesNotMatch(sql, /INSERT INTO/i);
  });

  it("display_filename nonblank CHECK on attachment usage rows", () => {
    const sql = migrationSql();
    assert.match(sql, /CHECK \(length\(trim\(display_filename\)\) > 0\)/);
  });

  it("original_filename nonblank CHECK on stored file and snapshots", () => {
    const sql = migrationSql();
    assert.match(sql, /CHECK \(length\(trim\(original_filename\)\) > 0\)/);
  });

  it("uses filesystem migration source only (no database bindings)", () => {
    const sql = migrationSql();
    assert.ok(sql.length > 0);
    assert.doesNotMatch(sql, /wrangler/i);
    assert.doesNotMatch(sql, /getPlatformProxy/i);
  });

  it("A: mail_signature_version_assets exists", () => {
    const sql = migrationSql();
    assert.match(sql, /CREATE TABLE mail_signature_version_assets/);
    const block =
      sql.match(/CREATE TABLE mail_signature_version_assets \([\s\S]*?\);/)?.[0] ??
      "";
    for (const col of [
      "signature_version_id",
      "stored_file_id",
      "content_hash",
      "asset_ref",
      "mime_type",
      "size_bytes",
      "sort_order",
    ]) {
      assert.match(block, new RegExp(col));
    }
  });

  it("B: mail_signature_snapshot_assets exists", () => {
    const sql = migrationSql();
    assert.match(sql, /CREATE TABLE mail_signature_snapshot_assets/);
    const block =
      sql.match(/CREATE TABLE mail_signature_snapshot_assets \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(block, /signature_snapshot_id TEXT NOT NULL/);
    assert.match(block, /asset_ref TEXT NOT NULL/);
  });

  it("C: signature version asset stored file + content_hash composite FK", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_signature_version_assets \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(
      block,
      /FOREIGN KEY \(stored_file_id, content_hash\)\s+REFERENCES mail_stored_files \(id, content_hash\)/,
    );
  });

  it("D: signature snapshot asset stored file + content_hash composite FK", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_signature_snapshot_assets \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(
      block,
      /FOREIGN KEY \(stored_file_id, content_hash\)\s+REFERENCES mail_stored_files \(id, content_hash\)/,
    );
  });

  it("E: signature asset_ref unique per Signature Version", () => {
    const sql = migrationSql();
    assert.match(sql, /UNIQUE \(signature_version_id, asset_ref\)/);
  });

  it("F: signature asset_ref unique per Signature Snapshot", () => {
    const sql = migrationSql();
    assert.match(sql, /UNIQUE \(signature_snapshot_id, asset_ref\)/);
  });

  it("G: signature snapshot asset table has NO updated_at", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_signature_snapshot_assets \([\s\S]*?\);/)?.[0] ??
      "";
    assert.doesNotMatch(block, /updated_at/i);
  });

  it("H: asset_refs_json documented as presentation metadata only", () => {
    const sql = migrationSql();
    assert.match(sql, /asset_refs_json/);
    assert.match(sql, /presentation\/editor metadata ONLY/i);
    assert.match(sql, /NOT authoritative for.*stored file identity/i);
    assert.match(
      sql,
      /Authoritative physical asset mapping: mail_signature_version_assets/,
    );
  });

  it("I: no signature asset table contains public/signed/download URL column", () => {
    const sql = migrationSql();
    for (const table of [
      "mail_signature_version_assets",
      "mail_signature_snapshot_assets",
    ]) {
      const block =
        sql.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\);`))?.[0] ??
        "";
      for (const forbidden of [
        "public_url",
        "download_url",
        "signed_url",
        "presigned_url",
        "storage_key",
      ]) {
        assert.doesNotMatch(block, new RegExp(`${forbidden} TEXT`, "i"));
      }
    }
  });

  it("J: message attachment source revision provenance composite FK", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_message_attachments \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(sql, /UNIQUE \(id, stored_file_id, content_hash\)/);
    assert.match(
      block,
      /FOREIGN KEY \(source_revision_attachment_id, stored_file_id, content_hash\)\s+REFERENCES mail_outbound_revision_attachments \(id, stored_file_id, content_hash\)/,
    );
  });

  it("K: inbound message attachment with source_revision_attachment_id NULL", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_message_attachments \([\s\S]*?\);/)?.[0] ??
      "";
    assert.match(block, /source_revision_attachment_id TEXT/);
    assert.doesNotMatch(block, /source_revision_attachment_id TEXT NOT NULL/);
  });

  it("L: stored file content_hash requires 64 lowercase hex characters", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_stored_files \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(block, /length\(content_hash\) = 64/);
    assert.match(block, /content_hash = lower\(content_hash\)/);
    assert.match(block, /content_hash NOT GLOB '\*\[\^0-9a-f\]\*'/);
  });

  it("M: content_hash remains NOT globally unique", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /UNIQUE\s*\(\s*content_hash\s*\)/i);
    assert.match(sql, /NOT globally unique/i);
  });

  it("N: unscanned + scanned_at NULL is valid structurally", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /security_scan_status = 'unscanned' AND security_scanned_at IS NULL/,
    );
  });

  it("O: unscanned requires scanned_at NULL — non-null would fail CHECK branch", () => {
    const sql = migrationSql();
    const block =
      sql.match(/CREATE TABLE mail_stored_files \([\s\S]*?\);/)?.[0] ?? "";
    const unscannedBranch =
      block.match(
        /security_scan_status = 'unscanned' AND security_scanned_at IS NULL/,
      )?.[0] ?? "";
    assert.ok(unscannedBranch.length > 0);
    assert.doesNotMatch(
      unscannedBranch,
      /security_scan_status = 'unscanned'[\s\S]*security_scanned_at IS NOT NULL/,
    );
  });

  it("P: clean/blocked/scan_failed require scanned_at non-null", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /security_scan_status IN \('clean', 'blocked', 'scan_failed'\)[\s\S]*?security_scanned_at IS NOT NULL/,
    );
  });

  it("Q: canonical attachment hash documentation EXCLUDES stored_file_id", () => {
    const sql = migrationSql();
    assert.match(sql, /EXCLUDED from external hash: stored_file_id/i);
    const inputsSection =
      sql.match(
        /Revision attachment canonical hash inputs[\s\S]*?secure_expiry_days/,
      )?.[0] ?? "";
    assert.doesNotMatch(inputsSection, /stored_file_id/);
  });

  it("R: canonical attachment hash documentation EXCLUDES storage key/bucket", () => {
    const sql = migrationSql();
    assert.match(sql, /storage_bucket/);
    assert.match(sql, /EXCLUDED from external hash:[\s\S]*?storage_bucket/i);
    assert.match(sql, /EXCLUDED from external hash:[\s\S]*?storage_key/i);
  });

  it("S: signature asset canonical contribution excludes internal DB row IDs", () => {
    const sql = migrationSql();
    assert.match(sql, /Signature snapshot asset canonical hash inputs/);
    assert.match(sql, /EXCLUDED: stored_file_id, storage_bucket, storage_key, database row IDs/);
  });

  it("T: no Approval/Transport/R2 API tables added", () => {
    const sql = migrationSql();
    for (const forbidden of [
      "mail_approval",
      "mail_send_operation",
      "mail_transport",
      "mail_secure_download",
      "mail_file_access",
    ]) {
      assert.doesNotMatch(sql, new RegExp(`CREATE TABLE ${forbidden}`, "i"));
    }
    assert.doesNotMatch(sql, /CREATE TABLE.*r2_/i);
  });
});
