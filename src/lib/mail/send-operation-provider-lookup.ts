import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";

export type SendOperationProviderLookup = {
  sendOperationId: string;
  transportAttemptId: string;
  outboundRevisionId: string;
  provider: string;
  providerRequestId: string | null;
  providerMessageId: string | null;
  sendStatus: string;
  transportState: string;
};

export async function findSendOperationByProviderMessageId(
  db: Database,
  input: {
    provider: string;
    providerMessageId: string;
  },
): Promise<SendOperationProviderLookup | null> {
  const providerMessageId = input.providerMessageId.trim();
  const provider = input.provider.trim();
  if (!providerMessageId || !provider) {
    return null;
  }

  const [attempt] = await db
    .select()
    .from(schema.mailTransportAttempts)
    .where(
      and(
        eq(schema.mailTransportAttempts.providerMessageId, providerMessageId),
        eq(schema.mailTransportAttempts.provider, provider),
      ),
    )
    .limit(2);

  if (!attempt) {
    return null;
  }

  const [send] = await db
    .select()
    .from(schema.mailSendOperations)
    .where(eq(schema.mailSendOperations.id, attempt.sendOperationId))
    .limit(1);

  if (!send) {
    return null;
  }

  return {
    sendOperationId: send.id,
    transportAttemptId: attempt.id,
    outboundRevisionId: send.outboundRevisionId,
    provider: attempt.provider,
    providerRequestId: attempt.providerRequestId,
    providerMessageId: attempt.providerMessageId,
    sendStatus: send.status,
    transportState: attempt.state,
  };
}

export async function findSendOperationByProviderRequestId(
  db: Database,
  input: {
    provider: string;
    providerRequestId: string;
  },
): Promise<SendOperationProviderLookup | null> {
  const providerRequestId = input.providerRequestId.trim();
  const provider = input.provider.trim();
  if (!providerRequestId || !provider) {
    return null;
  }

  const [attempt] = await db
    .select()
    .from(schema.mailTransportAttempts)
    .where(
      and(
        eq(schema.mailTransportAttempts.providerRequestId, providerRequestId),
        eq(schema.mailTransportAttempts.provider, provider),
      ),
    )
    .limit(2);

  if (!attempt) {
    return null;
  }

  const [send] = await db
    .select()
    .from(schema.mailSendOperations)
    .where(eq(schema.mailSendOperations.id, attempt.sendOperationId))
    .limit(1);

  if (!send) {
    return null;
  }

  return {
    sendOperationId: send.id,
    transportAttemptId: attempt.id,
    outboundRevisionId: send.outboundRevisionId,
    provider: attempt.provider,
    providerRequestId: attempt.providerRequestId,
    providerMessageId: attempt.providerMessageId,
    sendStatus: send.status,
    transportState: attempt.state,
  };
}

export async function resolveSendOperationFromProviderIds(
  db: Database,
  input: {
    provider: string;
    providerMessageId?: string | null;
    providerRequestId?: string | null;
  },
): Promise<SendOperationProviderLookup | null> {
  if (input.providerMessageId?.trim()) {
    const byMessage = await findSendOperationByProviderMessageId(db, {
      provider: input.provider,
      providerMessageId: input.providerMessageId,
    });
    if (byMessage) {
      return byMessage;
    }
  }

  if (input.providerRequestId?.trim()) {
    return findSendOperationByProviderRequestId(db, {
      provider: input.provider,
      providerRequestId: input.providerRequestId,
    });
  }

  return null;
}
