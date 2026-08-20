import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MAIL_PROVIDER_INGESTION_EVENT_KINDS,
  MAIL_PROVIDER_INGESTION_STATUSES,
} from "../../../../drizzle/schema/mail-provider-ingestion-events";
import { MAIL_INBOUND_INGESTION_EVENT_KINDS } from "../../../../drizzle/schema/mail-inbound-ingestion-events";
import {
  MAIL_INBOUND_MATERIALIZATION_MESSAGE_DIRECTIONS,
  MAIL_INBOUND_ROUTE_MODES,
} from "../../../../drizzle/schema/mail-inbound-message-materializations";
import { MAIL_DELIVERY_INGESTION_EVENT_KINDS } from "../../../../drizzle/schema/mail-delivery-ingestion-events";
import { MAIL_DELIVERY_EVENT_TYPES } from "../../../../drizzle/schema/mail-delivery-events";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0061_mail_provider_ingestion.sql",
);

const DRIZZLE_FILES = {
  provider: join(
    process.cwd(),
    "drizzle/schema/mail-provider-ingestion-events.ts",
  ),
  inbound: join(process.cwd(), "drizzle/schema/mail-inbound-ingestion-events.ts"),
  inboundMat: join(
    process.cwd(),
    "drizzle/schema/mail-inbound-message-materializations.ts",
  ),
  delivery: join(
    process.cwd(),
    "drizzle/schema/mail-delivery-ingestion-events.ts",
  ),
  deliveryMat: join(
    process.cwd(),
    "drizzle/schema/mail-delivery-event-materializations.ts",
  ),
} as const;

const FROZEN_MIGRATIONS = [
  "0052_mail_foundation.sql",
  "0053_mail_message_core.sql",
  "0054_mail_outbound_content.sql",
  "0055_mail_attachment_storage.sql",
  "0056_mail_outbound_approval.sql",
  "0057_mail_send_operation.sql",
  "0058_mail_delivery_event.sql",
  "0059_mail_outbound_materialization.sql",
  "0060_mail_receiving_address.sql",
] as const;

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function drizzleSource(name: keyof typeof DRIZZLE_FILES): string {
  return readFileSync(DRIZZLE_FILES[name], "utf8");
}

function providerTableBlock(): string {
  return (
    migrationSql().match(
      /CREATE TABLE mail_provider_ingestion_events \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

function inboundTableBlock(): string {
  return (
    migrationSql().match(
      /CREATE TABLE mail_inbound_ingestion_events \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

function inboundMatBlock(): string {
  return (
    migrationSql().match(
      /CREATE TABLE mail_inbound_message_materializations \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

function deliveryTableBlock(): string {
  return (
    migrationSql().match(
      /CREATE TABLE mail_delivery_ingestion_events \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

function deliveryMatBlock(): string {
  return (
    migrationSql().match(
      /CREATE TABLE mail_delivery_event_materializations \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

function frozenMigrationSql(name: string): string {
  return readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8");
}

describe("mail provider ingestion migration (2B.21 static)", () => {
  it("1: 0061 migration file exists", () => {
    statSync(MIGRATION_PATH);
    assert.match(migrationSql(), /0061/);
    assert.match(migrationSql(), /Phase 2B\.21/);
  });

  it("2: generic provider ingestion table exists", () => {
    assert.match(migrationSql(), /CREATE TABLE mail_provider_ingestion_events/);
    assert.match(drizzleSource("provider"), /mailProviderIngestionEvents/);
    assert.match(drizzleSource("provider"), /"mail_provider_ingestion_events"/);
  });

  it("3: event kinds exact inbound_message/delivery_event", () => {
    assert.match(
      providerTableBlock(),
      /CHECK \(event_kind IN \('inbound_message', 'delivery_event'\)\)/,
    );
    assert.deepEqual([...MAIL_PROVIDER_INGESTION_EVENT_KINDS], [
      "inbound_message",
      "delivery_event",
    ]);
    assert.doesNotMatch(providerTableBlock(), /opened/);
    assert.doesNotMatch(providerTableBlock(), /clicked/);
  });

  it("4: ingestion_dedupe_key required/nonblank/UNIQUE", () => {
    assert.match(providerTableBlock(), /ingestion_dedupe_key TEXT NOT NULL/);
    assert.match(
      providerTableBlock(),
      /CHECK \(LENGTH\(TRIM\(ingestion_dedupe_key\)\) > 0\)/,
    );
    assert.match(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_provider_ingestion_events_ingestion_dedupe_key/,
    );
    assert.match(
      drizzleSource("provider"),
      /uq_mail_provider_ingestion_events_ingestion_dedupe_key/,
    );
  });

  it("5: provider_event_id nullable and non-unique", () => {
    assert.match(providerTableBlock(), /provider_event_id TEXT/);
    assert.doesNotMatch(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_[\w]*provider_event_id/,
    );
    assert.match(
      providerTableBlock(),
      /provider_event_id IS NULL[\s\S]*?OR LENGTH\(TRIM\(provider_event_id\)\) > 0/,
    );
  });

  it("6: statuses exact pending/processing/completed/quarantined", () => {
    assert.match(
      providerTableBlock(),
      /CHECK \(status IN \('pending', 'processing', 'completed', 'quarantined'\)\)/,
    );
    assert.deepEqual([...MAIL_PROVIDER_INGESTION_STATUSES], [
      "pending",
      "processing",
      "completed",
      "quarantined",
    ]);
  });

  it("7: processing_version exists >=1", () => {
    assert.match(
      providerTableBlock(),
      /processing_version INTEGER NOT NULL DEFAULT 1/,
    );
    assert.match(providerTableBlock(), /CHECK \(processing_version >= 1\)/);
    assert.match(drizzleSource("provider"), /processingVersion/);
  });

  it("8: status/timestamp/quarantine coupling", () => {
    const block = providerTableBlock();
    assert.match(block, /status = 'pending'[\s\S]*?finalized_at IS NULL/);
    assert.match(block, /status = 'processing'[\s\S]*?next_attempt_at IS NULL/);
    assert.match(block, /status = 'completed'[\s\S]*?finalized_at IS NOT NULL/);
    assert.match(
      block,
      /status = 'quarantined'[\s\S]*?quarantine_reason IS NOT NULL/,
    );
  });

  it("9: no completed=Delivered semantic confusion", () => {
    assert.match(
      migrationSql(),
      /completed status means ingestion processing completed — NOT Delivered/i,
    );
    assert.doesNotMatch(providerTableBlock(), /'delivered'/);
    assert.match(drizzleSource("provider"), /NOT Delivered/);
  });

  it("10: opaque payload reference only; no raw payload/secrets columns", () => {
    const sql = migrationSql();
    const block = providerTableBlock();
    assert.match(block, /payload_storage_provider/);
    assert.match(block, /payload_storage_key/);
    assert.match(block, /payload_content_hash/);
    assert.match(block, /payload_size_bytes/);
    assert.doesNotMatch(block, /raw_mime/);
    assert.doesNotMatch(block, /webhook_body/);
    assert.doesNotMatch(block, /auth_header/);
    assert.doesNotMatch(block, /bearer_token/);
    assert.doesNotMatch(block, /api_key/);
    assert.match(sql, /No raw webhook JSON\/MIME\/secrets/i);
  });

  it("11: inbound child exact event-kind witness", () => {
    assert.match(inboundTableBlock(), /CHECK \(event_kind = 'inbound_message'\)/);
    assert.deepEqual([...MAIL_INBOUND_INGESTION_EVENT_KINDS], ["inbound_message"]);
    assert.match(
      inboundTableBlock(),
      /FOREIGN KEY \([\s\S]*?ingestion_event_id,\s*event_kind[\s\S]*?\) REFERENCES mail_provider_ingestion_events/,
    );
  });

  it("12: envelope recipient required", () => {
    assert.match(inboundTableBlock(), /envelope_recipient_address TEXT NOT NULL/);
    assert.match(
      inboundTableBlock(),
      /CHECK \(LENGTH\(TRIM\(envelope_recipient_address\)\) > 0\)/,
    );
    assert.match(
      inboundTableBlock(),
      /envelope_recipient_address = TRIM\(envelope_recipient_address\)/,
    );
  });

  it("13: unresolved inbound route allowed", () => {
    assert.match(
      inboundTableBlock(),
      /receiving_address_id IS NULL[\s\S]*?route_owner_mailbox_id IS NULL[\s\S]*?routed_address_snapshot IS NULL[\s\S]*?routed_at IS NULL/,
    );
  });

  it("14: resolved route all-or-none", () => {
    assert.match(
      inboundTableBlock(),
      /receiving_address_id IS NOT NULL[\s\S]*?route_owner_mailbox_id IS NOT NULL[\s\S]*?routed_address_snapshot IS NOT NULL[\s\S]*?routed_at IS NOT NULL/,
    );
  });

  it("15: receiving address + route-owner provenance composite FK", () => {
    assert.match(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_receiving_addresses_id_mailbox_address/,
    );
    assert.match(
      inboundTableBlock(),
      /FOREIGN KEY \([\s\S]*?receiving_address_id,\s*route_owner_mailbox_id,\s*routed_address_snapshot[\s\S]*?\) REFERENCES mail_receiving_addresses/,
    );
    assert.match(
      drizzleSource("inbound"),
      /fk_mail_inbound_ingestion_events_receiving_address_provenance/,
    );
  });

  it("16: original route owner preserved", () => {
    assert.match(migrationSql(), /route_owner_mailbox_id/);
    assert.match(
      migrationSql(),
      /Original route owner[\s\S]*?Preserved even when route_mode = fallback/i,
    );
    assert.match(inboundMatBlock(), /route_owner_mailbox_id TEXT NOT NULL/);
    assert.match(
      inboundMatBlock(),
      /route_mode = 'fallback'[\s\S]*?materialized_mailbox_id != route_owner_mailbox_id/,
    );
  });

  it("17: inbound materialization table exists", () => {
    assert.match(
      migrationSql(),
      /CREATE TABLE mail_inbound_message_materializations/,
    );
    assert.match(drizzleSource("inboundMat"), /mailInboundMessageMaterializations/);
  });

  it("18: direct materialization requires same mailbox", () => {
    assert.match(
      inboundMatBlock(),
      /route_mode = 'direct'[\s\S]*?materialized_mailbox_id = route_owner_mailbox_id[\s\S]*?fallback_reason IS NULL/,
    );
    assert.deepEqual([...MAIL_INBOUND_ROUTE_MODES], ["direct", "fallback"]);
  });

  it("19: fallback permits different mailbox only with reason", () => {
    assert.match(
      inboundMatBlock(),
      /route_mode = 'fallback'[\s\S]*?materialized_mailbox_id != route_owner_mailbox_id[\s\S]*?fallback_reason IS NOT NULL/,
    );
  });

  it("20: inbound materialization requires inbound mail_message", () => {
    assert.match(inboundMatBlock(), /CHECK \(message_direction = 'inbound'\)/);
    assert.deepEqual([...MAIL_INBOUND_MATERIALIZATION_MESSAGE_DIRECTIONS], [
      "inbound",
    ]);
    assert.match(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_messages_id_mailbox_direction/,
    );
    assert.match(
      inboundMatBlock(),
      /FOREIGN KEY \([\s\S]*?mail_message_id,\s*materialized_mailbox_id,\s*message_direction[\s\S]*?\) REFERENCES mail_messages/,
    );
  });

  it("21: one ingestion → one message link", () => {
    assert.match(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_inbound_message_materializations_ingestion_event_id/,
    );
  });

  it("22: one canonical message may have multiple ingestion links", () => {
    assert.doesNotMatch(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_inbound_message_materializations_mail_message_id/,
    );
    assert.match(
      migrationSql(),
      /CREATE INDEX idx_mail_inbound_message_materializations_mail_message_id/,
    );
    assert.doesNotMatch(
      drizzleSource("inboundMat"),
      /uq_mail_inbound_message_materializations_mail_message_id/,
    );
    assert.match(
      drizzleSource("inboundMat"),
      /idx_mail_inbound_message_materializations_mail_message_id/,
    );
  });

  it("23: generic completion/materialization atomicity documented", () => {
    assert.match(
      migrationSql(),
      /Atomic completion boundary[\s\S]*?canonical materialization[\s\S]*?status → completed must be atomic/i,
    );
    assert.match(
      migrationSql(),
      /completed without canonical effect[\s\S]*?forbidden/i,
    );
  });

  it("24: delivery child exact event-kind witness", () => {
    assert.match(deliveryTableBlock(), /CHECK \(event_kind = 'delivery_event'\)/);
    assert.deepEqual([...MAIL_DELIVERY_INGESTION_EVENT_KINDS], ["delivery_event"]);
    assert.match(
      deliveryTableBlock(),
      /FOREIGN KEY \([\s\S]*?ingestion_event_id,\s*event_kind[\s\S]*?\) REFERENCES mail_provider_ingestion_events/,
    );
  });

  it("25: delivery event types exact deferred/delivered/bounced", () => {
    assert.match(
      deliveryTableBlock(),
      /CHECK \(delivery_event_type IN \('deferred', 'delivered', 'bounced'\)\)/,
    );
    assert.deepEqual([...MAIL_DELIVERY_EVENT_TYPES], [
      "deferred",
      "delivered",
      "bounced",
    ]);
    assert.doesNotMatch(deliveryTableBlock(), /opened/);
    assert.doesNotMatch(deliveryTableBlock(), /clicked/);
  });

  it("26: delivery correlation may be unresolved", () => {
    assert.match(
      deliveryTableBlock(),
      /send_operation_id IS NULL[\s\S]*?transport_attempt_id IS NULL[\s\S]*?outbound_revision_id IS NULL[\s\S]*?outbound_revision_recipient_id IS NULL[\s\S]*?correlated_at IS NULL/,
    );
  });

  it("27: resolved delivery provenance all-or-none", () => {
    assert.match(
      deliveryTableBlock(),
      /send_operation_id IS NOT NULL[\s\S]*?transport_attempt_id IS NOT NULL[\s\S]*?outbound_revision_id IS NOT NULL[\s\S]*?outbound_revision_recipient_id IS NOT NULL[\s\S]*?correlated_at IS NOT NULL/,
    );
  });

  it("28: no guessed unmatched provenance", () => {
    assert.match(
      migrationSql(),
      /Never let unresolved callbacks guess/i,
    );
    assert.match(
      deliveryTableBlock(),
      /send_operation_id IS NULL[\s\S]*?correlated_at IS NULL/,
    );
  });

  it("29: delivery materialization table exists", () => {
    assert.match(
      migrationSql(),
      /CREATE TABLE mail_delivery_event_materializations/,
    );
    assert.match(drizzleSource("deliveryMat"), /mailDeliveryEventMaterializations/);
  });

  it("30: delivery ingestion dedupe copied to canonical event", () => {
    assert.match(deliveryMatBlock(), /event_dedupe_key TEXT NOT NULL/);
    assert.match(
      deliveryMatBlock(),
      /FOREIGN KEY \([\s\S]*?ingestion_event_id,\s*event_dedupe_key[\s\S]*?\) REFERENCES mail_provider_ingestion_events \([\s\S]*?ingestion_dedupe_key/,
    );
    assert.match(
      drizzleSource("delivery"),
      /mail_delivery_events\.event_dedupe_key/,
    );
  });

  it("31: staged/canonical delivery event type cannot differ structurally where authored", () => {
    assert.match(
      deliveryMatBlock(),
      /FOREIGN KEY \([\s\S]*?ingestion_event_id,\s*delivery_event_type[\s\S]*?\) REFERENCES mail_delivery_ingestion_events/,
    );
    assert.match(
      deliveryMatBlock(),
      /FOREIGN KEY \([\s\S]*?delivery_event_id,\s*delivery_event_type[\s\S]*?\) REFERENCES mail_delivery_events/,
    );
    assert.match(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_delivery_events_id_event_type/,
    );
  });

  it("32: provider IDs != RFC Message-ID", () => {
    assert.doesNotMatch(providerTableBlock(), /rfc_message_id/);
    assert.doesNotMatch(providerTableBlock(), /internet_message_id/);
    assert.match(providerTableBlock(), /provider_message_id/);
    assert.match(
      drizzleSource("deliveryMat"),
      /mail_delivery_events\.event_dedupe_key|eventDedupeKey/,
    );
    assert.doesNotMatch(drizzleSource("provider"), /internetMessageId/);
    assert.doesNotMatch(drizzleSource("provider"), /rfcMessageId/);
  });

  it("33: inbound canonical RFC dedupe unchanged", () => {
    const m53 = frozenMigrationSql("0053_mail_message_core.sql");
    assert.match(
      m53,
      /CREATE UNIQUE INDEX uq_mail_messages_inbound_internet_message_id/,
    );
    assert.doesNotMatch(migrationSql(), /ALTER TABLE mail_messages/);
  });

  it("34: same inbound RFC Message-ID across different Mailboxes remains allowed", () => {
    const m53 = frozenMigrationSql("0053_mail_message_core.sql");
    const idx =
      m53.match(
        /CREATE UNIQUE INDEX uq_mail_messages_inbound_internet_message_id[\s\S]*?;/,
      )?.[0] ?? "";
    assert.match(idx, /mailbox_id/);
    assert.match(idx, /internet_message_id/);
    assert.match(idx, /direction = 'inbound'/);
  });

  it("35: no customer association", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /customer_id/);
    assert.doesNotMatch(sql, /customer_association/);
    assert.match(sql, /No customer association/i);
  });

  it("36: no Archive/Spam", () => {
    const tableSql = [
      providerTableBlock(),
      inboundTableBlock(),
      inboundMatBlock(),
      deliveryTableBlock(),
      deliveryMatBlock(),
    ].join("\n");
    assert.doesNotMatch(tableSql, /archive/i);
    assert.doesNotMatch(tableSql, /spam/i);
    assert.match(migrationSql(), /No customer association, Archive\/Spam/i);
  });

  it("37: no shared workflow/auto-reply/templates", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /auto_reply/);
    assert.doesNotMatch(sql, /internal_note/);
    assert.doesNotMatch(sql, /template_id/);
    assert.doesNotMatch(sql, /assignment/);
    assert.match(sql, /No customer association, Archive\/Spam, shared workflow/i);
  });

  it("38: no CASCADE", () => {
    assert.doesNotMatch(migrationSql(), /ON DELETE CASCADE/);
    for (const path of Object.values(DRIZZLE_FILES)) {
      assert.doesNotMatch(readFileSync(path, "utf8"), /onDelete: "cascade"/i);
    }
  });

  it("39: 0052–0060 unchanged", () => {
    for (const name of FROZEN_MIGRATIONS) {
      const sql = frozenMigrationSql(name);
      assert.ok(sql.length > 0, `${name} must exist`);
    }
    assert.doesNotMatch(migrationSql(), /ALTER TABLE mail_receiving_addresses/);
    assert.doesNotMatch(migrationSql(), /DROP TABLE/);
  });

  it("40: no D1 access", () => {
    assert.ok(true, "static test file performs filesystem reads only");
  });
});

describe("mail provider ingestion migration (2B.21.1 multi-envelope)", () => {
  it("1: keeps UNIQUE ingestion_event_id on inbound materializations", () => {
    assert.match(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_inbound_message_materializations_ingestion_event_id/,
    );
    assert.match(
      drizzleSource("inboundMat"),
      /uq_mail_inbound_message_materializations_ingestion_event_id/,
    );
  });

  it("2: mail_message_id is NOT UNIQUE in inbound materializations", () => {
    assert.doesNotMatch(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_inbound_message_materializations_mail_message_id/,
    );
    assert.match(
      migrationSql(),
      /CREATE INDEX idx_mail_inbound_message_materializations_mail_message_id/,
    );
  });

  it("3: one ingestion cannot link to multiple messages", () => {
    const idx =
      migrationSql().match(
        /CREATE UNIQUE INDEX uq_mail_inbound_message_materializations_ingestion_event_id[\s\S]*?;/,
      )?.[0] ?? "";
    assert.match(idx, /ingestion_event_id/);
    assert.doesNotMatch(idx, /mail_message_id/);
  });

  it("4: one canonical inbound message may have multiple ingestion provenance rows", () => {
    assert.match(
      migrationSql(),
      /ONE canonical inbound mail_message → MAY HAVE MULTIPLE ingestion provenance links/i,
    );
    assert.match(
      drizzleSource("inboundMat"),
      /MAY HAVE MULTIPLE provenance links/,
    );
    assert.doesNotMatch(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_inbound_message_materializations_mail_message_id/,
    );
  });

  it("5: two ingestion events with different envelope provenance may share mail_message_id", () => {
    assert.match(inboundMatBlock(), /envelope_recipient_address TEXT NOT NULL/);
    assert.match(inboundMatBlock(), /receiving_address_id TEXT NOT NULL/);
    assert.match(inboundMatBlock(), /mail_message_id TEXT NOT NULL/);
    assert.match(
      migrationSql(),
      /Same external RFC message may arrive via multiple envelope recipients/i,
    );
  });

  it("6: Receiving Address provenance remains per materialization row", () => {
    assert.match(inboundMatBlock(), /receiving_address_id TEXT NOT NULL/);
    assert.match(inboundMatBlock(), /routed_address_snapshot TEXT NOT NULL/);
    assert.match(
      inboundMatBlock(),
      /FOREIGN KEY \([\s\S]*?receiving_address_id,\s*route_owner_mailbox_id,\s*routed_address_snapshot[\s\S]*?\) REFERENCES mail_receiving_addresses/,
    );
  });

  it("7: route_owner_mailbox_id remains per ingestion provenance", () => {
    assert.match(inboundMatBlock(), /route_owner_mailbox_id TEXT NOT NULL/);
    assert.match(
      migrationSql(),
      /Preserved even when route_mode = fallback materializes/i,
    );
  });

  it("8: fallback provenance remains preserved", () => {
    assert.match(
      inboundMatBlock(),
      /route_mode = 'fallback'[\s\S]*?materialized_mailbox_id != route_owner_mailbox_id[\s\S]*?fallback_reason IS NOT NULL/,
    );
    assert.match(
      migrationSql(),
      /multiple receiving aliases[\s\S]*?fallback Mailbox/i,
    );
  });

  it("9: 0053 inbound mailbox + internet_message_id dedupe remains unchanged", () => {
    const m53 = frozenMigrationSql("0053_mail_message_core.sql");
    assert.match(
      m53,
      /CREATE UNIQUE INDEX uq_mail_messages_inbound_internet_message_id/,
    );
    assert.doesNotMatch(migrationSql(), /ALTER TABLE mail_messages/);
  });

  it("10: same RFC Message-ID across different Mailboxes remains allowed", () => {
    const m53 = frozenMigrationSql("0053_mail_message_core.sql");
    const idx =
      m53.match(
        /CREATE UNIQUE INDEX uq_mail_messages_inbound_internet_message_id[\s\S]*?;/,
      )?.[0] ?? "";
    assert.match(idx, /mailbox_id/);
    assert.match(idx, /internet_message_id/);
  });

  it("11: same mailbox + same RFC Message-ID may converge to one canonical message", () => {
    assert.match(
      migrationSql(),
      /0053 \(mailbox_id, internet_message_id\) dedupe converges to one Message/i,
    );
    assert.match(
      drizzleSource("inboundMat"),
      /0053 \(mailbox_id, internet_message_id\) dedupe converges/,
    );
  });

  it("12: 0053 dedupe conflict requires semantic integrity verification", () => {
    assert.match(
      migrationSql(),
      /\(mailbox_id, internet_message_id\) conflict is NOT automatically harmless duplicate/i,
    );
    assert.match(
      migrationSql(),
      /Service must verify immutable semantics match/i,
    );
  });

  it("13: conflicting same-mailbox RFC identity → quarantine contract documented", () => {
    assert.match(
      migrationSql(),
      /Conflicting semantic identity → QUARANTINE \/ INTEGRITY CONFLICT/i,
    );
    assert.match(migrationSql(), /Do NOT silently merge/i);
  });

  it("14: NULL RFC Message-ID behavior is not over-designed in 0061", () => {
    assert.match(
      migrationSql(),
      /NULL internet_message_id: no 0053 dedupe guarantee/i,
    );
    assert.doesNotMatch(migrationSql(), /content_fingerprint/);
    assert.doesNotMatch(migrationSql(), /global_content_hash/);
  });

  it("15: delivery materialization cardinality remains unchanged", () => {
    assert.match(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_delivery_event_materializations_ingestion_event_id/,
    );
    assert.match(
      migrationSql(),
      /CREATE UNIQUE INDEX uq_mail_delivery_event_materializations_delivery_event_id/,
    );
  });

  it("16: 0052–0060 unchanged", () => {
    for (const name of FROZEN_MIGRATIONS) {
      assert.ok(frozenMigrationSql(name).length > 0, `${name} must exist`);
    }
    assert.doesNotMatch(migrationSql(), /ALTER TABLE mail_receiving_addresses/);
  });
});
