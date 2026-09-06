import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  MAIL_LARGE_ATTACHMENT_SCAN_JOB_STATUSES,
} from "../../../../drizzle/schema/mail-large-attachment-scan-jobs";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0074_mail_large_attachment_scan_jobs.sql",
);

test("0074 is a create-only durable scan-job migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  assert.match(sql, /CREATE TABLE mail_large_attachment_scan_jobs/);
  for (const column of [
    "lifecycle_id",
    "stored_file_id",
    "provider",
    "provider_job_id",
    "job_status",
    "storage_key",
    "storage_etag",
    "storage_version",
    "declared_content_hash",
    "provider_content_hash",
    "attempt_count",
    "next_attempt_at",
    "submitted_at",
    "completed_at",
    "last_error_code",
    "created_at",
    "updated_at",
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`));
  }
  assert.doesNotMatch(sql, /DROP TABLE|INSERT INTO|UPDATE mail_|DELETE FROM/i);
});

test("0074 preserves separate processing and canonical file status models", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  for (const status of MAIL_LARGE_ATTACHMENT_SCAN_JOB_STATUSES) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
  assert.match(
    sql,
    /FOREIGN KEY \(lifecycle_id\)[\s\S]*ON DELETE CASCADE/,
  );
  assert.match(
    sql,
    /FOREIGN KEY \(stored_file_id\)[\s\S]*ON DELETE CASCADE/,
  );
  assert.match(sql, /uq_mail_large_attachment_scan_jobs_lifecycle_id/);
  assert.match(sql, /idx_mail_large_attachment_scan_jobs_status_next_attempt/);
});
