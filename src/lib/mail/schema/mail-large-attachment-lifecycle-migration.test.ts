import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  MAIL_DELIVERY_MODES,
  MAIL_DELIVERY_MODES_FROZEN_0055,
} from "../../../../drizzle/schema/mail-draft-attachments";
import { MAIL_LARGE_ATTACHMENT_LIFECYCLE_STATUSES } from "../../../../drizzle/schema/mail-large-attachment-lifecycle";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0070_mail_large_attachment_lifecycle.sql",
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("mail large attachment lifecycle migration (0070)", () => {
  it("creates lifecycle table", () => {
    const sql = migrationSql();
    assert.match(sql, /CREATE TABLE mail_large_attachment_lifecycle/);
    for (const col of [
      "stored_file_id",
      "status",
      "uploaded_at",
      "temporary_expires_at",
      "approval_hold_started_at",
      "approval_absolute_expires_at",
      "sent_at",
      "recipient_expires_at",
      "deleted_at",
      "delete_reason",
      "download_token_hash",
      "download_count",
      "last_downloaded_at",
    ]) {
      assert.match(sql, new RegExp(col));
    }
  });

  it("extends delivery_mode to include large_attachment on usage tables", () => {
    const sql = migrationSql();
    assert.match(sql, /'large_attachment'/);
    for (const table of [
      "mail_draft_attachments_new",
      "mail_outbound_revision_attachments_new",
      "mail_message_attachments_new",
    ]) {
      assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
      const block =
        sql.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\);`))?.[0] ??
        "";
      assert.match(
        block,
        /delivery_mode IN \('direct_attachment', 'secure_file', 'large_attachment'\)/,
      );
    }
  });

  it("preserves legacy direct_attachment semantics", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /delivery_mode = 'direct_attachment' AND secure_expiry_days IS NULL/,
    );
  });

  it("preserves legacy secure_file semantics", () => {
    const sql = migrationSql();
    assert.match(sql, /delivery_mode = 'secure_file'/);
    assert.match(sql, /secure_expiry_days IN \(1, 3, 7\)/);
  });

  it("requires large_attachment secure_expiry_days NULL", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /delivery_mode = 'large_attachment' AND secure_expiry_days IS NULL/,
    );
  });

  it("defines lifecycle statuses", () => {
    const sql = migrationSql();
    for (const status of MAIL_LARGE_ATTACHMENT_LIFECYCLE_STATUSES) {
      assert.match(sql, new RegExp(`'${status}'`));
    }
  });

  it("indexes cleanup lookups", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /idx_mail_large_attachment_lifecycle_status_temporary_expires/,
    );
    assert.match(
      sql,
      /idx_mail_large_attachment_lifecycle_status_approval_absolute/,
    );
    assert.match(
      sql,
      /idx_mail_large_attachment_lifecycle_status_recipient_expires/,
    );
  });

  it("unique stored_file_id and download_token_hash", () => {
    const sql = migrationSql();
    assert.match(sql, /uq_mail_large_attachment_lifecycle_stored_file_id/);
    assert.match(sql, /uq_mail_large_attachment_lifecycle_download_token_hash/);
  });

  it("adds storage identity columns distinct from content_hash", () => {
    const sql = migrationSql();
    for (const col of [
      "declared_content_hash",
      "storage_version",
      "storage_etag",
      "finalized_at",
    ]) {
      assert.match(sql, new RegExp(col));
    }
    assert.match(
      sql,
      /storage_etag: authoritative R2 object identity at finalize — distinct/,
    );
  });

  it("creates persistent upload session table without presigned URL columns", () => {
    const sql = migrationSql();
    assert.match(sql, /CREATE TABLE mail_large_attachment_upload_sessions/);
    for (const col of [
      "actor_user_id",
      "draft_id",
      "mailbox_id",
      "storage_key",
      "declared_content_hash",
      "expires_at",
      "finalized_at",
      "invalidated_at",
    ]) {
      assert.match(sql, new RegExp(col));
    }
    assert.match(sql, /uq_mail_large_attachment_upload_sessions_storage_key/);
    const uploadBlock =
      sql.match(
        /CREATE TABLE mail_large_attachment_upload_sessions \([\s\S]*?\);/,
      )?.[0] ?? "";
    assert.doesNotMatch(uploadBlock, /presigned/i);
  });

  it("documents data-preserving schema rebuild classification", () => {
    const sql = migrationSql();
    assert.match(sql, /DATA-PRESERVING SCHEMA REBUILD/i);
    assert.match(sql, /PRAGMA defer_foreign_keys = ON/);
    assert.match(sql, /pass 2: restore composite revision FK/);
  });

  it("does not drop legacy attachment data", () => {
    const sql = migrationSql();
    assert.match(sql, /INSERT INTO mail_draft_attachments_new/);
    assert.match(sql, /INSERT INTO mail_outbound_revision_attachments_new/);
    assert.match(sql, /INSERT INTO mail_message_attachments_new/);
    assert.doesNotMatch(sql, /DROP TABLE mail_stored_files/i);
  });

  it("schema TypeScript includes large_attachment delivery mode", () => {
    assert.ok(MAIL_DELIVERY_MODES.includes("large_attachment"));
    assert.deepEqual(MAIL_DELIVERY_MODES_FROZEN_0055, [
      "direct_attachment",
      "secure_file",
    ]);
  });
});
