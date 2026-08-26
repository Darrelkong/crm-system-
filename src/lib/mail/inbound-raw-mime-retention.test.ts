import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPLETED_RAW_MIME_RETENTION_DAYS,
  isInboundRawMimeRetentionEligible,
  QUARANTINED_RAW_MIME_RETENTION_DAYS,
  subtractRetentionDays,
} from "@/lib/mail/inbound-raw-mime-retention";
import {
  FailingInboundRawPayloadStore,
  INBOUND_RAW_PAYLOAD_KEY_PREFIX,
  MemoryInboundRawPayloadStore,
} from "@/lib/mail/inbound-raw-payload-store";
import {
  purgeInboundRawMimeForEvent,
} from "@/lib/mail/inbound-raw-mime-retention-service";

const TRUST_NOW = "2026-08-27T00:00:00.000Z";

describe("inbound raw mime retention policy", () => {
  it("completed events become eligible only after 14 days", () => {
    const finalizedAt = subtractRetentionDays(TRUST_NOW, COMPLETED_RAW_MIME_RETENTION_DAYS);
    assert.equal(
      isInboundRawMimeRetentionEligible({
        eventKind: "inbound_message",
        status: "completed",
        payloadStorageKey: `${INBOUND_RAW_PAYLOAD_KEY_PREFIX}abc`,
        finalizedAt: subtractRetentionDays(TRUST_NOW, 13),
        trustNow: TRUST_NOW,
      }),
      false,
    );
    assert.equal(
      isInboundRawMimeRetentionEligible({
        eventKind: "inbound_message",
        status: "completed",
        payloadStorageKey: `${INBOUND_RAW_PAYLOAD_KEY_PREFIX}abc`,
        finalizedAt,
        trustNow: TRUST_NOW,
      }),
      true,
    );
  });

  it("quarantined events become eligible only after 60 days", () => {
    const finalizedAt = subtractRetentionDays(TRUST_NOW, QUARANTINED_RAW_MIME_RETENTION_DAYS);
    assert.equal(
      isInboundRawMimeRetentionEligible({
        eventKind: "inbound_message",
        status: "quarantined",
        payloadStorageKey: `${INBOUND_RAW_PAYLOAD_KEY_PREFIX}abc`,
        finalizedAt: subtractRetentionDays(TRUST_NOW, 59),
        trustNow: TRUST_NOW,
      }),
      false,
    );
    assert.equal(
      isInboundRawMimeRetentionEligible({
        eventKind: "inbound_message",
        status: "quarantined",
        payloadStorageKey: `${INBOUND_RAW_PAYLOAD_KEY_PREFIX}abc`,
        finalizedAt,
        trustNow: TRUST_NOW,
      }),
      true,
    );
  });

  it("pending and processing events are never eligible", () => {
    for (const status of ["pending", "processing"] as const) {
      assert.equal(
        isInboundRawMimeRetentionEligible({
          eventKind: "inbound_message",
          status,
          payloadStorageKey: `${INBOUND_RAW_PAYLOAD_KEY_PREFIX}abc`,
          finalizedAt: subtractRetentionDays(TRUST_NOW, 365),
          trustNow: TRUST_NOW,
        }),
        false,
      );
    }
  });
});

describe("purgeInboundRawMimeForEvent namespace safety", () => {
  it("skips keys outside mail/raw-ingestion/", async () => {
    const store = new MemoryInboundRawPayloadStore();
    const outcome = await purgeInboundRawMimeForEvent(
      {} as never,
      store,
      {
        id: "evt-1",
        payloadStorageKey: "attachments/unsafe-key",
        status: "completed",
      },
    );
    assert.equal(outcome, "skipped");
  });

  it("returns error when R2 delete fails and preserves state", async () => {
    const store = new FailingInboundRawPayloadStore("delete failed");
    const key = `${INBOUND_RAW_PAYLOAD_KEY_PREFIX}fail`;
    const outcome = await purgeInboundRawMimeForEvent(
      {} as never,
      store,
      {
        id: "evt-2",
        payloadStorageKey: key,
        status: "completed",
      },
    );
    assert.equal(outcome, "error");
  });
});
