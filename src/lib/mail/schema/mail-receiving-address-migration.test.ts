import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MAIL_RECEIVING_ADDRESS_STATUSES,
  MAIL_RECEIVING_ADDRESS_TYPES,
} from "../../../../drizzle/schema/mail-receiving-addresses";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0060_mail_receiving_address.sql",
);

const DRIZZLE_PATH = join(
  process.cwd(),
  "drizzle/schema/mail-receiving-addresses.ts",
);

const FROZEN_MIGRATIONS = [
  "0052_mail_foundation.sql",
  "0053_mail_message_core.sql",
  "0054_mail_outbound_content.sql",
  "0055_mail_attachment_storage.sql",
  "0056_mail_outbound_approval.sql",
  "0057_mail_send_operation.sql",
  "0058_mail_delivery_event.sql",
  "0059_mail_outbound_materialization.sql",
] as const;

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function drizzleSource(): string {
  return readFileSync(DRIZZLE_PATH, "utf8");
}

function receivingTableBlock(): string {
  return (
    migrationSql().match(
      /CREATE TABLE mail_receiving_addresses \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

function frozenMigrationSql(name: string): string {
  return readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8");
}

describe("mail receiving address migration (2B.19 static)", () => {
  it("1: 0060 migration file exists", () => {
    statSync(MIGRATION_PATH);
    assert.match(migrationSql(), /0060/);
    assert.match(migrationSql(), /Phase 2B\.19/);
  });

  it("2: mail_receiving_addresses table exists", () => {
    assert.match(migrationSql(), /CREATE TABLE mail_receiving_addresses/);
    assert.match(drizzleSource(), /mailReceivingAddresses/);
    assert.match(drizzleSource(), /"mail_receiving_addresses"/);
  });

  it("3: address_type exact primary/alias", () => {
    assert.match(receivingTableBlock(), /CHECK \(address_type IN \('primary', 'alias'\)\)/);
    assert.deepEqual([...MAIL_RECEIVING_ADDRESS_TYPES], ["primary", "alias"]);
    assert.doesNotMatch(receivingTableBlock(), /from_identity/);
    assert.doesNotMatch(receivingTableBlock(), /sender/);
  });

  it("4: status exact active/suspended/retired", () => {
    assert.match(
      receivingTableBlock(),
      /CHECK \(status IN \('active', 'suspended', 'retired'\)\)/,
    );
    assert.deepEqual(
      [...MAIL_RECEIVING_ADDRESS_STATUSES],
      ["active", "suspended", "retired"],
    );
  });

  it("5: retired_at bidirectional coupling", () => {
    assert.match(
      receivingTableBlock(),
      /\(status = 'retired' AND retired_at IS NOT NULL\)/,
    );
    assert.match(
      receivingTableBlock(),
      /\(status != 'retired' AND retired_at IS NULL\)/,
    );
  });

  it("6: mailbox_id required", () => {
    assert.match(receivingTableBlock(), /mailbox_id TEXT NOT NULL/);
    assert.match(
      receivingTableBlock(),
      /FOREIGN KEY \(mailbox_id\) REFERENCES mail_mailboxes \(id\)/,
    );
  });

  it("7: no CASCADE on mailbox FK", () => {
    assert.doesNotMatch(receivingTableBlock(), /ON DELETE CASCADE/);
    assert.doesNotMatch(migrationSql(), /ON DELETE CASCADE/);
  });

  it("8: lifetime case-insensitive trimmed address uniqueness", () => {
    assert.match(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_receiving_addresses_address[\s\S]*?ON mail_receiving_addresses \(lower\(trim\(address\)\)\)/,
    );
    assert.match(drizzleSource(), /uq_mail_receiving_addresses_address/);
    assert.match(drizzleSource(), /lower\(trim\(\$\{table\.address\}\)\)/);
  });

  it("9: uniqueness includes retired rows (unconditional index)", () => {
    const idxBlock =
      migrationSql().match(
        /CREATE UNIQUE INDEX uq_mail_receiving_addresses_address[\s\S]*?;/,
      )?.[0] ?? "";
    assert.doesNotMatch(idxBlock, /WHERE/i);
    assert.match(
      migrationSql(),
      /active, suspended, AND retired rows included/i,
    );
  });

  it("10: at most one current primary receiving address per mailbox", () => {
    const idxBlock =
      migrationSql().match(
        /CREATE UNIQUE INDEX uq_mail_receiving_addresses_primary_per_mailbox[\s\S]*?;/,
      )?.[0] ?? "";
    assert.match(idxBlock, /WHERE address_type = 'primary'/);
    assert.match(idxBlock, /status IN \('active', 'suspended'\)/);
    assert.match(drizzleSource(), /uq_mail_receiving_addresses_primary_per_mailbox/);
    assert.match(
      drizzleSource(),
      /addressType} = 'primary' AND \$\{table\.status\} IN \('active', 'suspended'\)/,
    );
  });

  it("11: multiple aliases per mailbox structurally allowed", () => {
    assert.match(migrationSql(), /Multiple aliases allowed/i);
    assert.doesNotMatch(migrationSql(), /uq_mail_receiving_addresses_alias/);
    const idxBlock =
      migrationSql().match(
        /CREATE UNIQUE INDEX uq_mail_receiving_addresses_primary_per_mailbox[\s\S]*?;/,
      )?.[0] ?? "";
    assert.doesNotMatch(idxBlock, /address_type = 'alias'/);
  });

  it("12: one receiving address cannot route to two mailboxes", () => {
    assert.match(
      migrationSql(),
      /Lifetime case-insensitive address uniqueness prevents one address → two mailboxes/i,
    );
    assert.match(receivingTableBlock(), /mailbox_id TEXT NOT NULL/);
    assert.match(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_receiving_addresses_address/,
    );
  });

  it("13: no sender_identity FK", () => {
    assert.doesNotMatch(receivingTableBlock(), /mail_sender_identities/);
    assert.doesNotMatch(drizzleSource(), /mailSenderIdentities/);
    assert.doesNotMatch(
      receivingTableBlock(),
      /FOREIGN KEY[\s\S]*?sender_identity/,
    );
  });

  it("14: same textual address is NOT globally prohibited from also being a Sender Identity", () => {
    assert.match(
      migrationSql(),
      /The same normalized address MAY exist in mail_receiving_addresses AND[\s\S]*?mail_sender_identities/,
    );
    assert.doesNotMatch(
      migrationSql(),
      /CREATE UNIQUE INDEX[\s\S]*?mail_sender_identities/,
    );
    assert.match(migrationSql(), /Do NOT create cross-table uniqueness here/);
  });

  it("15: sender_identity.alias_of_identity_id is not inbound routing", () => {
    assert.match(
      migrationSql(),
      /MUST NOT inspect mail_sender_identities\.alias_of_identity_id/i,
    );
    assert.doesNotMatch(receivingTableBlock(), /alias_of_identity_id/);
    assert.doesNotMatch(
      migrationSql(),
      /FOREIGN KEY[\s\S]*?alias_of_identity_id/,
    );
  });

  it("16: primary receiving row mirrors mailbox primary-address concept", () => {
    assert.match(
      migrationSql(),
      /mail_mailboxes\.address remains the Mailbox primary address identity/i,
    );
    assert.match(migrationSql(), /address_type = primary rows are the inbound routing representation/);
    assert.match(
      migrationSql(),
      /CURRENT primary receiving row[\s\S]*?MUST match mail_mailboxes\.address under product normalization semantics/i,
    );
    assert.match(migrationSql(), /trim, Unicode NFC, lowercase/i);
    assert.doesNotMatch(
      migrationSql(),
      /mailbox-address mutation service MUST[\s\S]*?synchronized atomically/i,
    );
    assert.match(migrationSql(), /address_type[\s\S]*?'primary'/);
  });

  it("17: existing mailboxes receive fail-closed primary-route backfill", () => {
    assert.match(migrationSql(), /INSERT INTO mail_receiving_addresses/);
    assert.doesNotMatch(migrationSql(), /INSERT OR IGNORE INTO mail_receiving_addresses/);
    assert.doesNotMatch(migrationSql(), /INSERT OR REPLACE INTO mail_receiving_addresses/);
    assert.match(migrationSql(), /FROM mail_mailboxes m/);
    assert.match(migrationSql(), /'mra_primary_' \|\| m\.id/);
    assert.match(migrationSql(), /TRIM\(m\.address\)/);
    assert.match(migrationSql(), /'primary'/);
    assert.match(migrationSql(), /every Mailbox MUST receive exactly one[\s\S]*?primary row/i);
  });

  it("18: retired address cannot be reused", () => {
    assert.match(
      migrationSql(),
      /A retired address cannot be reused by another Mailbox/i,
    );
    assert.match(migrationSql(), /never hard-deleted for reuse/i);
    const idxBlock =
      migrationSql().match(
        /CREATE UNIQUE INDEX uq_mail_receiving_addresses_address[\s\S]*?;/,
      )?.[0] ?? "";
    assert.doesNotMatch(idxBlock, /WHERE/i);
  });

  it("19: envelope provenance intentionally deferred to next domain", () => {
    assert.match(
      migrationSql(),
      /Envelope provenance[\s\S]*?deferred to the next inbound ingestion domain/i,
    );
    assert.doesNotMatch(migrationSql(), /envelope_recipient/);
    assert.doesNotMatch(migrationSql(), /receiving_address_id/);
  });

  it("20: no provider/webhook tables created", () => {
    assert.doesNotMatch(migrationSql(), /CREATE TABLE mail_inbound/);
    assert.doesNotMatch(migrationSql(), /CREATE TABLE mail_webhook/);
    assert.doesNotMatch(migrationSql(), /CREATE TABLE mail_provider/);
    assert.doesNotMatch(migrationSql(), /CREATE TABLE mail_.*quarantine/);
  });

  it("21: 0052–0059 unchanged", () => {
    for (const name of FROZEN_MIGRATIONS) {
      const path = join(process.cwd(), "drizzle/migrations", name);
      const before = statSync(path);
      assert.ok(before.isFile(), `${name} must exist`);
      assert.match(frozenMigrationSql(name), /CREATE TABLE/);
    }
    assert.doesNotMatch(migrationSql(), /ALTER TABLE mail_mailboxes/);
    assert.doesNotMatch(migrationSql(), /ALTER TABLE mail_sender_identities/);
  });

  it("22: no D1 access in static test scope", () => {
    assert.doesNotMatch(migrationSql(), /wrangler d1/);
    assert.doesNotMatch(drizzleSource(), /D1Database/);
  });
});

describe("mail receiving address migration (2B.19.1 integrity)", () => {
  function migrationSql(): string {
    return readFileSync(MIGRATION_PATH, "utf8");
  }

  function receivingTableBlock(): string {
    return (
      migrationSql().match(
        /CREATE TABLE mail_receiving_addresses \([\s\S]*?\);/,
      )?.[0] ?? ""
    );
  }

  it("A: backfill uses INSERT INTO, not INSERT OR IGNORE", () => {
    assert.match(migrationSql(), /INSERT INTO mail_receiving_addresses/);
    assert.doesNotMatch(migrationSql(), /INSERT OR IGNORE INTO mail_receiving_addresses/);
  });

  it("B: backfill does not use OR REPLACE", () => {
    assert.doesNotMatch(migrationSql(), /INSERT OR REPLACE INTO mail_receiving_addresses/);
  });

  it("C: address has nonblank CHECK", () => {
    assert.match(receivingTableBlock(), /CHECK \(LENGTH\(TRIM\(address\)\) > 0\)/);
  });

  it("D: address rejects empty string conceptually", () => {
    assert.match(
      migrationSql(),
      /Blank or whitespace-only mailbox addresses fail LENGTH\(TRIM\(address\)\) > 0 CHECK/i,
    );
    assert.match(receivingTableBlock(), /LENGTH\(TRIM\(address\)\) > 0/);
  });

  it("E: address rejects spaces-only conceptually", () => {
    assert.match(migrationSql(), /whitespace-only mailbox addresses fail/i);
  });

  it("F: stored address cannot contain surrounding whitespace", () => {
    assert.match(receivingTableBlock(), /CHECK \(address = TRIM\(address\)\)/);
    assert.match(migrationSql(), /Stored address MUST equal TRIM\(address\)/);
  });

  it("G: lifetime UNIQUE uses case-insensitive trimmed semantics", () => {
    assert.match(
      migrationSql(),
      /uq_mail_receiving_addresses_address[\s\S]*?lower\(trim\(address\)\)/,
    );
  });

  it("H: retired rows remain inside unconditional UNIQUE namespace", () => {
    const idxBlock =
      migrationSql().match(
        /CREATE UNIQUE INDEX uq_mail_receiving_addresses_address[\s\S]*?;/,
      )?.[0] ?? "";
    assert.doesNotMatch(idxBlock, /WHERE/i);
    assert.match(migrationSql(), /active, suspended, AND retired rows included/i);
  });

  it("I: backfill trims mail_mailboxes.address", () => {
    assert.match(migrationSql(), /TRIM\(m\.address\)/);
    assert.doesNotMatch(migrationSql(), /INSERT INTO mail_receiving_addresses[\s\S]*?m\.address,/);
  });

  it("J: malformed existing mailbox address is not silently skipped", () => {
    assert.doesNotMatch(migrationSql(), /INSERT OR IGNORE/);
    assert.match(migrationSql(), /constraint conflicts or blank addresses after TRIM abort the migration/i);
  });

  it("K: deterministic primary backfill ID remains", () => {
    assert.match(migrationSql(), /'mra_primary_' \|\| m\.id/);
    assert.match(migrationSql(), /Deterministic IDs: mra_primary_/);
  });

  it("L: one primary backfill row per existing Mailbox remains the migration contract", () => {
    assert.match(migrationSql(), /one primary receiving route per existing Mailbox/i);
    const idxBlock =
      migrationSql().match(
        /CREATE UNIQUE INDEX uq_mail_receiving_addresses_primary_per_mailbox[\s\S]*?;/,
      )?.[0] ?? "";
    assert.match(idxBlock, /status IN \('active', 'suspended'\)/);
  });

  it("M: Mailbox/Sender Identity separation remains unchanged", () => {
    assert.match(migrationSql(), /Mailbox != Sender Identity/);
    assert.match(
      migrationSql(),
      /The same normalized address MAY exist in mail_receiving_addresses AND[\s\S]*?mail_sender_identities/,
    );
    assert.doesNotMatch(receivingTableBlock(), /mail_sender_identities/);
  });

  it("N: envelope provenance remains deferred", () => {
    assert.match(
      migrationSql(),
      /Envelope provenance[\s\S]*?deferred to the next inbound ingestion domain/i,
    );
    assert.doesNotMatch(migrationSql(), /envelope_recipient/);
  });

  it("O: 0052–0059 unchanged", () => {
    for (const name of FROZEN_MIGRATIONS) {
      assert.match(
        readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8"),
        /CREATE TABLE/,
      );
    }
    assert.doesNotMatch(migrationSql(), /ALTER TABLE mail_mailboxes/);
  });
});

describe("mail receiving address migration (2B.19.2 primary rotation)", () => {
  function migrationSql(): string {
    return readFileSync(MIGRATION_PATH, "utf8");
  }

  function currentPrimaryPartialUniqueBlock(): string {
    return (
      migrationSql().match(
        /CREATE UNIQUE INDEX uq_mail_receiving_addresses_primary_per_mailbox[\s\S]*?;/,
      )?.[0] ?? ""
    );
  }

  it("1: current-primary partial UNIQUE includes primary + active/suspended", () => {
    const block = currentPrimaryPartialUniqueBlock();
    assert.match(block, /WHERE address_type = 'primary'/);
    assert.match(block, /status IN \('active', 'suspended'\)/);
  });

  it("2: retired primary is excluded from current-primary UNIQUE", () => {
    const block = currentPrimaryPartialUniqueBlock();
    assert.doesNotMatch(block, /status IN \('active', 'suspended', 'retired'\)/);
    assert.match(migrationSql(), /Retired historical Primary rows are excluded/i);
  });

  it("3: one active Primary per Mailbox structurally allowed", () => {
    assert.match(migrationSql(), /At most one CURRENT primary receiving route per Mailbox/i);
  });

  it("4: active + second active structurally rejected", () => {
    const block = currentPrimaryPartialUniqueBlock();
    assert.match(block, /UNIQUE INDEX uq_mail_receiving_addresses_primary_per_mailbox/);
    assert.match(block, /status IN \('active', 'suspended'\)/);
  });

  it("5: suspended + active structurally rejected", () => {
    assert.match(currentPrimaryPartialUniqueBlock(), /status IN \('active', 'suspended'\)/);
  });

  it("6: suspended + suspended structurally rejected", () => {
    assert.match(currentPrimaryPartialUniqueBlock(), /status IN \('active', 'suspended'\)/);
  });

  it("7: retired Primary + active Primary structurally allowed", () => {
    assert.match(migrationSql(), /Zero or more retired historical Primary rows may coexist/i);
    assert.match(
      migrationSql(),
      /retired historical Primary and no current Primary/i,
    );
  });

  it("8: multiple retired historical Primaries structurally allowed", () => {
    assert.match(migrationSql(), /HISTORICAL PRIMARY: address_type = primary AND status = retired/i);
    assert.match(migrationSql(), /Zero or more retired historical Primary rows may coexist/i);
  });

  it("9: retired Primary address remains protected by lifetime address UNIQUE", () => {
    assert.match(
      migrationSql(),
      /uq_mail_receiving_addresses_address[\s\S]*?lower\(trim\(address\)\)/,
    );
    assert.match(migrationSql(), /old addresses remain[\s\S]*?globally reserved/i);
  });

  it("10: old Primary row is preserved during future rotation contract", () => {
    assert.match(migrationSql(), /Preserve old row permanently as historical Primary/i);
    assert.match(migrationSql(), /Do NOT simply overwrite an existing Primary Receiving Address row/i);
  });

  it("11: future service must not simply overwrite old Primary address", () => {
    assert.match(migrationSql(), /Do NOT simply overwrite an existing Primary Receiving Address row/i);
  });

  it("12: future rotation atomicity requirement documented", () => {
    assert.match(migrationSql(), /Preferred atomic lifecycle/i);
    assert.match(migrationSql(), /Unsafe independent statements must not temporarily leave/i);
    assert.match(migrationSql(), /two current Primaries/i);
    assert.match(migrationSql(), /no current Primary/i);
    assert.match(
      migrationSql(),
      /mail_mailboxes\.address mismatched from current Primary/i,
    );
  });

  it("13: existing backfill unchanged", () => {
    assert.match(migrationSql(), /INSERT INTO mail_receiving_addresses/);
    assert.match(migrationSql(), /'mra_primary_' \|\| m\.id/);
    assert.match(migrationSql(), /TRIM\(m\.address\)/);
    assert.match(migrationSql(), /WHEN 'deleted' THEN 'retired'/);
  });

  it("14: deleted mailbox → retired Primary remains valid", () => {
    assert.match(
      migrationSql(),
      /Deleted mailbox may therefore have one retired historical Primary and no current Primary/i,
    );
  });

  it("15: aliases unaffected", () => {
    assert.match(migrationSql(), /current-primary rule does not apply to aliases/i);
    assert.doesNotMatch(
      currentPrimaryPartialUniqueBlock(),
      /address_type = 'alias'/,
    );
  });

  it("16: 0052–0059 unchanged", () => {
    for (const name of FROZEN_MIGRATIONS) {
      assert.match(
        readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8"),
        /CREATE TABLE/,
      );
    }
  });
});
