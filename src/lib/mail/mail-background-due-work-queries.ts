import { and, asc, eq, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";

export type ProviderIngestionDueRow = {
  id: string;
  processingVersion: number;
  receivedAt: string;
  nextAttemptAt: string | null;
};

export type ExpiredProviderProcessingRow = {
  id: string;
  processingVersion: number;
  eventKind: "inbound_message" | "delivery_event";
  processingLeaseExpiresAt: string | null;
};

export type NotificationOutboxDueRow = {
  id: string;
  processingVersion: number;
  enqueuedAt: string;
  nextAttemptAt: string | null;
  status: "pending" | "failed_retryable" | "processing" | "sent" | "failed_permanent";
};

export type ExpiredNotificationProcessingRow = {
  id: string;
  processingVersion: number;
  processingLeaseExpiresAt: string | null;
};

export type OutboundSendOperationDueRow = {
  id: string;
  orchestrationVersion: number;
  createdAt: string;
  nextAttemptAt: string | null;
};

export type AcceptedOutboundSendMaterializationDueRow = {
  id: string;
  outboundRevisionId: string;
  completedAt: string | null;
};

function dueProviderPredicate(trustNow: string) {
  return and(
    eq(schema.mailProviderIngestionEvents.status, "pending"),
    or(
      sql`${schema.mailProviderIngestionEvents.nextAttemptAt} IS NULL`,
      lte(schema.mailProviderIngestionEvents.nextAttemptAt, trustNow),
    ),
  );
}

export async function listDueInboundProviderIngestionEvents(
  db: Database,
  input: { trustNow: string; limit: number },
): Promise<ProviderIngestionDueRow[]> {
  return db
    .select({
      id: schema.mailProviderIngestionEvents.id,
      processingVersion: schema.mailProviderIngestionEvents.processingVersion,
      receivedAt: schema.mailProviderIngestionEvents.receivedAt,
      nextAttemptAt: schema.mailProviderIngestionEvents.nextAttemptAt,
    })
    .from(schema.mailProviderIngestionEvents)
    .where(
      and(
        eq(schema.mailProviderIngestionEvents.eventKind, "inbound_message"),
        dueProviderPredicate(input.trustNow),
      ),
    )
    .orderBy(
      asc(
        sql`coalesce(${schema.mailProviderIngestionEvents.nextAttemptAt}, ${schema.mailProviderIngestionEvents.receivedAt})`,
      ),
      asc(schema.mailProviderIngestionEvents.id),
    )
    .limit(input.limit);
}

export async function listDueDeliveryProviderIngestionEvents(
  db: Database,
  input: { trustNow: string; limit: number },
): Promise<ProviderIngestionDueRow[]> {
  return db
    .select({
      id: schema.mailProviderIngestionEvents.id,
      processingVersion: schema.mailProviderIngestionEvents.processingVersion,
      receivedAt: schema.mailProviderIngestionEvents.receivedAt,
      nextAttemptAt: schema.mailProviderIngestionEvents.nextAttemptAt,
    })
    .from(schema.mailProviderIngestionEvents)
    .where(
      and(
        eq(schema.mailProviderIngestionEvents.eventKind, "delivery_event"),
        dueProviderPredicate(input.trustNow),
      ),
    )
    .orderBy(
      asc(
        sql`coalesce(${schema.mailProviderIngestionEvents.nextAttemptAt}, ${schema.mailProviderIngestionEvents.receivedAt})`,
      ),
      asc(schema.mailProviderIngestionEvents.id),
    )
    .limit(input.limit);
}

export async function listExpiredLeasedProviderIngestionEvents(
  db: Database,
  input: { trustNow: string; limit: number },
): Promise<ExpiredProviderProcessingRow[]> {
  return db
    .select({
      id: schema.mailProviderIngestionEvents.id,
      processingVersion: schema.mailProviderIngestionEvents.processingVersion,
      eventKind: schema.mailProviderIngestionEvents.eventKind,
      processingLeaseExpiresAt:
        schema.mailProviderIngestionEvents.processingLeaseExpiresAt,
    })
    .from(schema.mailProviderIngestionEvents)
    .where(
      and(
        eq(schema.mailProviderIngestionEvents.status, "processing"),
        isNotNull(schema.mailProviderIngestionEvents.processingStartedAt),
        isNotNull(schema.mailProviderIngestionEvents.processingLeaseExpiresAt),
        lte(
          schema.mailProviderIngestionEvents.processingLeaseExpiresAt,
          input.trustNow,
        ),
      ),
    )
    .orderBy(
      asc(schema.mailProviderIngestionEvents.processingLeaseExpiresAt),
      asc(schema.mailProviderIngestionEvents.id),
    )
    .limit(input.limit);
}

function dueNotificationOutboxPredicate(trustNow: string) {
  return or(
    eq(schema.mailNotificationOutbox.status, "pending"),
    and(
      eq(schema.mailNotificationOutbox.status, "failed_retryable"),
      isNotNull(schema.mailNotificationOutbox.nextAttemptAt),
      lte(schema.mailNotificationOutbox.nextAttemptAt, trustNow),
    ),
  );
}

export async function listDueGeneralNotificationOutboxEvents(
  db: Database,
  input: { trustNow: string; limit: number },
): Promise<NotificationOutboxDueRow[]> {
  return db
    .select({
      id: schema.mailNotificationOutbox.id,
      processingVersion: schema.mailNotificationOutbox.processingVersion,
      enqueuedAt: schema.mailNotificationOutbox.enqueuedAt,
      nextAttemptAt: schema.mailNotificationOutbox.nextAttemptAt,
      status: schema.mailNotificationOutbox.status,
    })
    .from(schema.mailNotificationOutbox)
    .where(
      and(
        dueNotificationOutboxPredicate(input.trustNow),
        ne(
          schema.mailNotificationOutbox.sourceEntityType,
          MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationIdentityVerification,
        ),
      ),
    )
    .orderBy(
      asc(
        sql`coalesce(${schema.mailNotificationOutbox.nextAttemptAt}, ${schema.mailNotificationOutbox.enqueuedAt})`,
      ),
      asc(schema.mailNotificationOutbox.id),
    )
    .limit(input.limit);
}

export async function listDueVerificationNotificationOutboxEvents(
  db: Database,
  input: { trustNow: string; limit: number },
): Promise<NotificationOutboxDueRow[]> {
  return db
    .select({
      id: schema.mailNotificationOutbox.id,
      processingVersion: schema.mailNotificationOutbox.processingVersion,
      enqueuedAt: schema.mailNotificationOutbox.enqueuedAt,
      nextAttemptAt: schema.mailNotificationOutbox.nextAttemptAt,
      status: schema.mailNotificationOutbox.status,
    })
    .from(schema.mailNotificationOutbox)
    .where(
      and(
        dueNotificationOutboxPredicate(input.trustNow),
        eq(
          schema.mailNotificationOutbox.sourceEntityType,
          MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationIdentityVerification,
        ),
      ),
    )
    .orderBy(
      asc(
        sql`coalesce(${schema.mailNotificationOutbox.nextAttemptAt}, ${schema.mailNotificationOutbox.enqueuedAt})`,
      ),
      asc(schema.mailNotificationOutbox.id),
    )
    .limit(input.limit);
}

export async function listDueNotificationOutboxEvents(
  db: Database,
  input: { trustNow: string; limit: number },
): Promise<NotificationOutboxDueRow[]> {
  return db
    .select({
      id: schema.mailNotificationOutbox.id,
      processingVersion: schema.mailNotificationOutbox.processingVersion,
      enqueuedAt: schema.mailNotificationOutbox.enqueuedAt,
      nextAttemptAt: schema.mailNotificationOutbox.nextAttemptAt,
      status: schema.mailNotificationOutbox.status,
    })
    .from(schema.mailNotificationOutbox)
    .where(dueNotificationOutboxPredicate(input.trustNow))
    .orderBy(
      asc(
        sql`coalesce(${schema.mailNotificationOutbox.nextAttemptAt}, ${schema.mailNotificationOutbox.enqueuedAt})`,
      ),
      asc(schema.mailNotificationOutbox.id),
    )
    .limit(input.limit);
}

function dueOutboundSendPredicate(trustNow: string) {
  return and(
    eq(schema.mailSendOperations.status, "pending"),
    or(
      sql`${schema.mailSendOperations.nextAttemptAt} IS NULL`,
      lte(schema.mailSendOperations.nextAttemptAt, trustNow),
    ),
  );
}

export async function listDueOutboundSendOperations(
  db: Database,
  input: { trustNow: string; limit: number },
): Promise<OutboundSendOperationDueRow[]> {
  return db
    .select({
      id: schema.mailSendOperations.id,
      orchestrationVersion: schema.mailSendOperations.orchestrationVersion,
      createdAt: schema.mailSendOperations.createdAt,
      nextAttemptAt: schema.mailSendOperations.nextAttemptAt,
    })
    .from(schema.mailSendOperations)
    .where(dueOutboundSendPredicate(input.trustNow))
    .orderBy(
      asc(
        sql`coalesce(${schema.mailSendOperations.nextAttemptAt}, ${schema.mailSendOperations.createdAt})`,
      ),
      asc(schema.mailSendOperations.id),
    )
    .limit(input.limit);
}

export async function listAcceptedOutboundSendsNeedingMaterialization(
  db: Database,
  input: { limit: number },
): Promise<AcceptedOutboundSendMaterializationDueRow[]> {
  return db
    .select({
      id: schema.mailSendOperations.id,
      outboundRevisionId: schema.mailSendOperations.outboundRevisionId,
      completedAt: schema.mailSendOperations.completedAt,
    })
    .from(schema.mailSendOperations)
    .leftJoin(
      schema.mailOutboundMessageMaterializations,
      eq(
        schema.mailOutboundMessageMaterializations.sendOperationId,
        schema.mailSendOperations.id,
      ),
    )
    .where(
      and(
        eq(schema.mailSendOperations.status, "accepted"),
        sql`${schema.mailOutboundMessageMaterializations.id} IS NULL`,
      ),
    )
    .orderBy(
      asc(
        sql`coalesce(${schema.mailSendOperations.completedAt}, ${schema.mailSendOperations.createdAt})`,
      ),
      asc(schema.mailSendOperations.id),
    )
    .limit(input.limit);
}

export async function listExpiredNotificationProcessingEvents(
  db: Database,
  input: { trustNow: string; limit: number },
): Promise<ExpiredNotificationProcessingRow[]> {
  return db
    .select({
      id: schema.mailNotificationOutbox.id,
      processingVersion: schema.mailNotificationOutbox.processingVersion,
      processingLeaseExpiresAt:
        schema.mailNotificationOutbox.processingLeaseExpiresAt,
    })
    .from(schema.mailNotificationOutbox)
    .where(
      and(
        eq(schema.mailNotificationOutbox.status, "processing"),
        isNotNull(schema.mailNotificationOutbox.processingLeaseExpiresAt),
        lte(
          schema.mailNotificationOutbox.processingLeaseExpiresAt,
          input.trustNow,
        ),
      ),
    )
    .orderBy(
      asc(schema.mailNotificationOutbox.processingLeaseExpiresAt),
      asc(schema.mailNotificationOutbox.id),
    )
    .limit(input.limit);
}
