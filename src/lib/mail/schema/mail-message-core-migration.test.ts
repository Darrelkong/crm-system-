import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAIL_COMPOSE_MODES,
  MAIL_MESSAGE_DIRECTIONS,
  MAIL_MESSAGE_SENSITIVITIES,
} from "../../../../drizzle/schema/mail-messages";
import { MAIL_RECIPIENT_TYPES } from "../../../../drizzle/schema/mail-message-recipients";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0053_mail_message_core.sql",
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("mail message core migration (static)", () => {
  // Static schema inspection does NOT replace actual SQLite/D1 constraint execution.
  it("defines all five core message tables", () => {
    const sql = migrationSql();
    for (const table of [
      "mail_threads",
      "mail_messages",
      "mail_message_bodies",
      "mail_message_recipients",
      "mail_message_read_states",
    ]) {
      assert.match(sql, new RegExp(`CREATE TABLE ${table}`), table);
    }
  });

  it("thread requires mailbox_id", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE TABLE mail_threads[\s\S]*?mailbox_id TEXT NOT NULL/,
    );
    assert.match(sql, /FOREIGN KEY \(mailbox_id\) REFERENCES mail_mailboxes \(id\)/);
  });

  it("enforces message/thread mailbox invariant via composite FK", () => {
    const sql = migrationSql();
    assert.match(sql, /UNIQUE \(id, mailbox_id\)/);
    assert.match(
      sql,
      /FOREIGN KEY \(thread_id, mailbox_id\) REFERENCES mail_threads \(id, mailbox_id\)/,
    );
  });

  it("does not define lifecycle_state on mail_messages", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /lifecycle_state/i);
  });

  it("defines direction enum", () => {
    const sql = migrationSql();
    assert.match(sql, /CHECK \(direction IN \('inbound', 'outbound'\)\)/);
    for (const direction of MAIL_MESSAGE_DIRECTIONS) {
      assert.match(sql, new RegExp(`'${direction}'`));
    }
  });

  it("requires received_at for inbound messages", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /direction = 'inbound'[\s\S]*?received_at IS NOT NULL/,
    );
  });

  it("defines sensitivity enum", () => {
    const sql = migrationSql();
    for (const sensitivity of MAIL_MESSAGE_SENSITIVITIES) {
      assert.match(sql, new RegExp(`'${sensitivity}'`));
    }
  });

  it("scopes inbound Message-ID dedup per mailbox", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_messages_inbound_internet_message_id[\s\S]*?ON mail_messages \(mailbox_id, internet_message_id\)/,
    );
    assert.match(sql, /WHERE internet_message_id IS NOT NULL AND direction = 'inbound'/);
    assert.doesNotMatch(
      sql,
      /UNIQUE.*internet_message_id[\s\S]*?WHERE[\s\S]*?direction = 'outbound'/i,
    );
  });

  it("defines recipient types and case-insensitive cross-type uniqueness", () => {
    const sql = migrationSql();
    for (const type of MAIL_RECIPIENT_TYPES) {
      assert.match(sql, new RegExp(`'${type}'`));
    }
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_message_recipients_message_address[\s\S]*?lower\(address\)/,
    );
    assert.doesNotMatch(
      sql,
      /recipient_type, lower\(address\)/i,
      "uniqueness must not be scoped per recipient_type",
    );
  });

  it("read state supports is_read and mark-unread representation", () => {
    const sql = migrationSql();
    assert.match(sql, /is_read INTEGER NOT NULL DEFAULT 0/);
    assert.match(sql, /read_at TEXT/);
    assert.match(
      sql,
      /\(is_read = 1 AND read_at IS NOT NULL\)\s+OR \(is_read = 0 AND read_at IS NULL\)/,
    );
    assert.match(sql, /PRIMARY KEY \(message_id, user_id\)/);
  });

  it("stores personal important on read states, not messages", () => {
    const sql = migrationSql();
    const messagesBlock =
      sql.match(/CREATE TABLE mail_messages \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(sql, /is_important_personal INTEGER/);
    assert.doesNotMatch(messagesBlock, /is_important/i);
  });

  it("documents no-row read state semantic", () => {
    const sql = migrationSql();
    assert.match(sql, /No row semantic/i);
    assert.match(sql, /absent row => unread/i);
  });

  it("documents Bcc security boundary", () => {
    const sql = migrationSql();
    assert.match(sql, /SECURITY-CRITICAL.*Bcc/i);
  });

  it("documents sanitized-only HTML bodies", () => {
    const sql = migrationSql();
    assert.match(sql, /body_html_sanitized/);
    assert.match(sql, /server-sanitized HTML ONLY/i);
  });

  it("does not use destructive CASCADE on core mail history FKs", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
    assert.match(sql, /sender_identity_id.*ON DELETE SET NULL/i);
  });

  it("A: inbound allows sender_identity_id IS NULL", () => {
    const messagesBlock =
      migrationSql().match(/CREATE TABLE mail_messages \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(
      messagesBlock,
      /direction = 'inbound'[\s\S]*?sender_identity_id IS NULL/,
    );
  });

  it("B: inbound rejects sender_identity_id IS NOT NULL", () => {
    const messagesBlock =
      migrationSql().match(/CREATE TABLE mail_messages \([\s\S]*?\);/)?.[0] ?? "";
    const inboundBranch =
      messagesBlock.match(
        /\(direction = 'inbound'[\s\S]*?received_at IS NOT NULL\)/,
      )?.[0] ?? "";
    assert.ok(inboundBranch.length > 0, "inbound CHECK branch must exist");
    assert.match(inboundBranch, /sender_identity_id IS NULL/);
    assert.doesNotMatch(inboundBranch, /sender_identity_id IS NOT NULL/);
  });

  it("C: outbound rejects sender_identity_id IS NULL", () => {
    const messagesBlock =
      migrationSql().match(/CREATE TABLE mail_messages \([\s\S]*?\);/)?.[0] ?? "";
    const outboundBranch =
      messagesBlock.match(
        /\(direction = 'outbound'[\s\S]*?compose_mode IN \('new', 'reply', 'reply_all', 'forward'\)\)/,
      )?.[0] ?? "";
    assert.match(outboundBranch, /sender_identity_id IS NOT NULL/);
    assert.doesNotMatch(outboundBranch, /sender_identity_id IS NULL/);
  });

  it("D: outbound structurally requires sender_identity_id IS NOT NULL", () => {
    const messagesBlock =
      migrationSql().match(/CREATE TABLE mail_messages \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(messagesBlock, /sender_identity_id TEXT/);
    assert.match(
      messagesBlock,
      /direction = 'outbound'[\s\S]*?sender_identity_id IS NOT NULL/,
    );
  });

  it("E: inbound allows compose_mode IS NULL", () => {
    const messagesBlock =
      migrationSql().match(/CREATE TABLE mail_messages \([\s\S]*?\);/)?.[0] ?? "";
    assert.match(
      messagesBlock,
      /direction = 'inbound'[\s\S]*?compose_mode IS NULL/,
    );
  });

  it("F: inbound rejects compose_mode = reply", () => {
    const messagesBlock =
      migrationSql().match(/CREATE TABLE mail_messages \([\s\S]*?\);/)?.[0] ?? "";
    const inboundBranch =
      messagesBlock.match(
        /\(direction = 'inbound'[\s\S]*?received_at IS NOT NULL\)/,
      )?.[0] ?? "";
    assert.match(inboundBranch, /compose_mode IS NULL/);
    assert.doesNotMatch(inboundBranch, /compose_mode IN/);
  });

  it("G: outbound rejects compose_mode IS NULL via explicit IS NOT NULL", () => {
    const messagesBlock =
      migrationSql().match(/CREATE TABLE mail_messages \([\s\S]*?\);/)?.[0] ?? "";
    const outboundBranch =
      messagesBlock.match(
        /\(direction = 'outbound'[\s\S]*?compose_mode IN \('new', 'reply', 'reply_all', 'forward'\)\)/,
      )?.[0] ?? "";
    assert.match(outboundBranch, /compose_mode IS NOT NULL/);
    assert.match(
      outboundBranch,
      /compose_mode IN \('new', 'reply', 'reply_all', 'forward'\)/,
    );
    assert.match(
      migrationSql(),
      /SQLite treats CHECK expressions that evaluate to NULL as satisfied/i,
    );
  });

  it("H: outbound allows each compose_mode value", () => {
    const messagesBlock =
      migrationSql().match(/CREATE TABLE mail_messages \([\s\S]*?\);/)?.[0] ?? "";
    for (const mode of MAIL_COMPOSE_MODES) {
      assert.match(messagesBlock, new RegExp(`'${mode}'`));
    }
    assert.match(
      messagesBlock,
      /compose_mode IN \('new', 'reply', 'reply_all', 'forward'\)/,
    );
  });

  it("read state CHECK couples is_read and read_at bidirectionally", () => {
    const readBlock =
      migrationSql().match(
        /CREATE TABLE mail_message_read_states \([\s\S]*?\);/,
      )?.[0] ?? "";
    assert.match(readBlock, /is_read = 1 AND read_at IS NOT NULL/);
    assert.match(readBlock, /is_read = 0 AND read_at IS NULL/);
  });

  it("static schema inspection does not replace SQLite runtime verification", () => {
    const source = readFileSync(import.meta.filename, "utf8");
    assert.match(
      source,
      /Static schema inspection does NOT replace actual SQLite/i,
    );
  });

  it("does not insert seed data", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /INSERT INTO/i);
  });

  it("uses filesystem migration source only (no database bindings)", () => {
    const source = readFileSync(import.meta.filename, "utf8");
    const importLines = source.match(/^import .+$/gm) ?? [];
    for (const line of importLines) {
      assert.doesNotMatch(line, /\/lib\/db/);
      assert.doesNotMatch(line, /miniflare/);
    }
  });
});
