import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSql = readFileSync(
  new URL(
    "../../../../drizzle/migrations/0074_mail_large_attachment_acknowledgements.sql",
    import.meta.url,
  ),
  "utf8",
);
const executableSql = migrationSql.replace(/--.*$/gm, "");

test("0074 acknowledgement migration is create-only", () => {
  assert.match(
    migrationSql,
    /CREATE TABLE mail_large_attachment_acknowledgements/i,
  );
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX uq_mail_large_attachment_ack_upload_session/i,
  );
  assert.match(migrationSql, /CREATE INDEX idx_mail_large_attachment_ack_lifecycle/i);
  assert.doesNotMatch(executableSql, /\bDROP\b/i);
  assert.doesNotMatch(executableSql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(executableSql, /\bUPDATE\b/i);
  assert.doesNotMatch(executableSql, /_new\b/i);
});

test("0074 stores exact uploader and upload lineage", () => {
  for (const column of [
    "upload_session_id",
    "lifecycle_id",
    "stored_file_id",
    "user_id",
    "draft_id",
    "mailbox_id",
    "notice_version",
    "acknowledged_at",
    "created_at",
  ]) {
    assert.match(migrationSql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(migrationSql, /REFERENCES mail_large_attachment_upload_sessions/);
  assert.match(migrationSql, /REFERENCES mail_large_attachment_lifecycle/);
  assert.match(migrationSql, /REFERENCES mail_stored_files/);
});
