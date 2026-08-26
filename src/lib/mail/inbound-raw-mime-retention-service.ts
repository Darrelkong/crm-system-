import { and, asc, eq, isNotNull, lte, or } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import {
  COMPLETED_RAW_MIME_RETENTION_DAYS,
  QUARANTINED_RAW_MIME_RETENTION_DAYS,
  subtractRetentionDays,
} from "@/lib/mail/inbound-raw-mime-retention";
import {
  isInboundRawPayloadStorageKey,
  type InboundRawPayloadStore,
} from "@/lib/mail/inbound-raw-payload-store";

export type InboundRawMimePurgeCandidate = {
  id: string;
  payloadStorageKey: string;
  status: "completed" | "quarantined";
};

export type InboundRawMimePurgeItemOutcome =
  | "purged"
  | "already_missing"
  | "skipped"
  | "error";

export type InboundRawMimeRetentionTickCounters = {
  eligible: number;
  purged: number;
  alreadyMissing: number;
  skipped: number;
  errors: number;
};

export function emptyInboundRawMimeRetentionCounters(): InboundRawMimeRetentionTickCounters {
  return {
    eligible: 0,
    purged: 0,
    alreadyMissing: 0,
    skipped: 0,
    errors: 0,
  };
}

export async function listEligibleInboundRawMimePurgeEvents(
  db: Database,
  input: { trustNow: string; limit: number },
): Promise<InboundRawMimePurgeCandidate[]> {
  const completedCutoff = subtractRetentionDays(
    input.trustNow,
    COMPLETED_RAW_MIME_RETENTION_DAYS,
  );
  const quarantinedCutoff = subtractRetentionDays(
    input.trustNow,
    QUARANTINED_RAW_MIME_RETENTION_DAYS,
  );

  const rows = await db
    .select({
      id: schema.mailProviderIngestionEvents.id,
      payloadStorageKey: schema.mailProviderIngestionEvents.payloadStorageKey,
      status: schema.mailProviderIngestionEvents.status,
    })
    .from(schema.mailProviderIngestionEvents)
    .where(
      and(
        eq(schema.mailProviderIngestionEvents.eventKind, "inbound_message"),
        isNotNull(schema.mailProviderIngestionEvents.payloadStorageKey),
        isNotNull(schema.mailProviderIngestionEvents.finalizedAt),
        or(
          and(
            eq(schema.mailProviderIngestionEvents.status, "completed"),
            lte(schema.mailProviderIngestionEvents.finalizedAt, completedCutoff),
          ),
          and(
            eq(schema.mailProviderIngestionEvents.status, "quarantined"),
            lte(
              schema.mailProviderIngestionEvents.finalizedAt,
              quarantinedCutoff,
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(schema.mailProviderIngestionEvents.finalizedAt))
    .limit(input.limit);

  return rows.flatMap((row) => {
    if (!row.payloadStorageKey) {
      return [];
    }
    if (row.status !== "completed" && row.status !== "quarantined") {
      return [];
    }
    return [
      {
        id: row.id,
        payloadStorageKey: row.payloadStorageKey,
        status: row.status,
      },
    ];
  });
}

async function reconcilePurgedRawPayloadReference(
  db: Database,
  ingestionEventId: string,
  expectedStorageKey: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      payloadStorageKey: schema.mailProviderIngestionEvents.payloadStorageKey,
    })
    .from(schema.mailProviderIngestionEvents)
    .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId))
    .limit(1);

  if (!row || row.payloadStorageKey !== expectedStorageKey) {
    return false;
  }

  await db
    .update(schema.mailProviderIngestionEvents)
    .set({
      payloadStorageProvider: null,
      payloadStorageKey: null,
      payloadContentHash: null,
      payloadSizeBytes: null,
    })
    .where(
      and(
        eq(schema.mailProviderIngestionEvents.id, ingestionEventId),
        eq(schema.mailProviderIngestionEvents.payloadStorageKey, expectedStorageKey),
      ),
    );

  return true;
}

/**
 * Purges one eligible inbound raw MIME object and reconciles D1 availability state.
 * Safe to retry when the R2 object is already missing.
 */
export async function purgeInboundRawMimeForEvent(
  db: Database,
  store: InboundRawPayloadStore,
  candidate: InboundRawMimePurgeCandidate,
): Promise<InboundRawMimePurgeItemOutcome> {
  if (!isInboundRawPayloadStorageKey(candidate.payloadStorageKey)) {
    return "skipped";
  }

  try {
    const deleteOutcome = await store.delete(candidate.payloadStorageKey);
    if (deleteOutcome === "already_missing") {
      const reconciled = await reconcilePurgedRawPayloadReference(
        db,
        candidate.id,
        candidate.payloadStorageKey,
      );
      return reconciled ? "already_missing" : "skipped";
    }

    const reconciled = await reconcilePurgedRawPayloadReference(
      db,
      candidate.id,
      candidate.payloadStorageKey,
    );
    if (!reconciled) {
      return "skipped";
    }
    return "purged";
  } catch {
    return "error";
  }
}

export async function runInboundRawMimeRetentionCleanup(
  db: Database,
  store: InboundRawPayloadStore,
  input: { trustNow: string; limit: number },
): Promise<InboundRawMimeRetentionTickCounters> {
  const counters = emptyInboundRawMimeRetentionCounters();
  const candidates = await listEligibleInboundRawMimePurgeEvents(db, input);
  counters.eligible = candidates.length;

  for (const candidate of candidates) {
    const outcome = await purgeInboundRawMimeForEvent(db, store, candidate);
    if (outcome === "purged") {
      counters.purged += 1;
    } else if (outcome === "already_missing") {
      counters.alreadyMissing += 1;
    } else if (outcome === "skipped") {
      counters.skipped += 1;
    } else {
      counters.errors += 1;
    }
  }

  return counters;
}
