import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSql = readFileSync(
  new URL(
    "../../../../drizzle/migrations/0075_mail_large_attachment_delivery_tokens.sql",
    import.meta.url,
  ),
  "utf8",
);
const executableSql = migrationSql.replace(/--.*$/gm, "");

test("0075 delivery-token migration is create-only", () => {
  assert.match(
    migrationSql,
    /CREATE TABLE mail_large_attachment_delivery_tokens/i,
  );
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX uq_mail_large_attachment_delivery_tokens_active_lifecycle_revision_send/i,
  );
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX uq_mail_large_attachment_delivery_tokens_token_hash/i,
  );
  assert.doesNotMatch(executableSql, /\bDROP\b/i);
  assert.doesNotMatch(executableSql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(executableSql, /\bUPDATE\b/i);
  assert.doesNotMatch(executableSql, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(executableSql, /_new\b/i);
});

test("0075 stores only token hash and exact send lineage", () => {
  for (const column of [
    "lifecycle_id",
    "revision_id",
    "send_operation_id",
    "transport_attempt_id",
    "token_hash",
    "state",
    "expires_at",
    "created_at",
    "armed_at",
    "confirmed_at",
    "revoked_at",
    "provider_message_id",
    "provider_accepted_at",
  ]) {
    assert.match(migrationSql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(migrationSql, /REFERENCES mail_large_attachment_lifecycle/);
  assert.match(migrationSql, /REFERENCES mail_outbound_revisions/);
  assert.match(migrationSql, /REFERENCES mail_send_operations/);
  assert.match(migrationSql, /REFERENCES mail_transport_attempts/);
  assert.doesNotMatch(migrationSql, /\braw_token\b/i);
  assert.doesNotMatch(migrationSql, /\btoken\b\s+TEXT\b/i);
});
