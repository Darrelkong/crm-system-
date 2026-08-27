import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { CloudflareEmailSendBinding } from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import { MailServiceError } from "@/lib/mail/errors";
import {
  BUSINESS_EMAIL_BINDING_UNAVAILABLE,
  assertBusinessEmailBindingForProductionMode,
} from "@/lib/mail/outbound-business-email-binding";
import { recordOutboundSendPreflightBlocked } from "@/lib/mail/outbound-send-preflight-service";
import { resolveOutboundMailTransportAdapter } from "@/lib/mail/outbound-transport-wiring";
import {
  isOutboundTransportDispatchAllowed,
  resolveMailOutboundTransportMode,
  type MailOutboundTransportMode,
} from "@/lib/mail/outbound-transport-constants";
import { dispatchSendOperation } from "@/lib/mail/send-operation-service";
import { SYSTEM_MAIL_ACTOR } from "@/lib/mail/system-mail-actor";
import type { MailTransportAdapter } from "@/lib/mail/transport/mail-transport-adapter";
import type { MailBackgroundTickCategoryCounters } from "@/lib/mail/mail-background-tick-service";

export type OutboundBackgroundDispatchDeps = {
  env: Record<string, string | undefined>;
  db: Database;
  businessEmailBinding?: CloudflareEmailSendBinding;
  notificationEmailBinding?: CloudflareEmailSendBinding;
  attachmentsBucket?: Parameters<typeof resolveOutboundMailTransportAdapter>[0]["attachmentsBucket"];
  resolveAdapter?: (input: {
    env: Record<string, string | undefined>;
    db: Database;
    businessEmailBinding?: CloudflareEmailSendBinding;
    attachmentsBucket?: Parameters<typeof resolveOutboundMailTransportAdapter>[0]["attachmentsBucket"];
  }) => MailTransportAdapter;
};

export type OutboundBackgroundDispatchItem = {
  id: string;
  orchestrationVersion: number;
};

export type OutboundBackgroundDispatchResult = {
  counters: MailBackgroundTickCategoryCounters;
  transportMode: MailOutboundTransportMode;
  dispatchSkipped: boolean;
};

function emptyCounters(): MailBackgroundTickCategoryCounters {
  return {
    selected: 0,
    claimed: 0,
    completed: 0,
    recovered: 0,
    quarantined: 0,
    retryScheduled: 0,
    permanentFailed: 0,
    skipped: 0,
    errors: 0,
  };
}

export async function processOutboundBackgroundDispatchItem(
  db: Database,
  deps: OutboundBackgroundDispatchDeps,
  item: OutboundBackgroundDispatchItem,
): Promise<
  "completed" | "retry_scheduled" | "permanent_failed" | "skipped" | "error"
> {
  const transportMode = resolveMailOutboundTransportMode(deps.env);

  if (!isOutboundTransportDispatchAllowed(transportMode)) {
    return "skipped";
  }

  try {
    assertBusinessEmailBindingForProductionMode({
      transportMode,
      businessEmailBinding: deps.businessEmailBinding,
    });
  } catch (error) {
    const send = await dispatchSendOperationLookup(db, item.id);
    if (send) {
      await recordOutboundSendPreflightBlocked(
        db,
        SYSTEM_MAIL_ACTOR,
        send,
        error,
        {
          code: BUSINESS_EMAIL_BINDING_UNAVAILABLE,
          transportMode,
        },
      );
    }
    return "permanent_failed";
  }

  const resolveAdapter =
    deps.resolveAdapter ??
    ((input) =>
      resolveOutboundMailTransportAdapter({
        env: input.env,
        db: input.db,
        businessEmailBinding: input.businessEmailBinding,
        attachmentsBucket: input.attachmentsBucket,
      }));

  const adapter = resolveAdapter({
    env: deps.env,
    db: deps.db,
    businessEmailBinding: deps.businessEmailBinding,
    attachmentsBucket: deps.attachmentsBucket,
  });

  try {
    const result = await dispatchSendOperation(db, SYSTEM_MAIL_ACTOR, {
      sendOperationId: item.id,
      expectedOrchestrationVersion: item.orchestrationVersion,
      adapter,
      transportMode,
    });

    if (result.status === "accepted" || result.status === "failed" || result.status === "dispatch_uncertain") {
      return "completed";
    }
    if (result.status === "pending") {
      return "retry_scheduled";
    }
    return "completed";
  } catch (error) {
    if (error instanceof MailServiceError) {
      if (error.errorCode === "CONFLICT" || error.errorCode === "STALE_VERSION") {
        return "skipped";
      }
      if (error.errorCode === "FORBIDDEN") {
        return "permanent_failed";
      }
    }
    return "error";
  }
}

async function dispatchSendOperationLookup(
  db: Database,
  sendOperationId: string,
) {
  const [row] = await db
    .select()
    .from(schema.mailSendOperations)
    .where(eq(schema.mailSendOperations.id, sendOperationId))
    .limit(1);
  return row ?? null;
}

export function createOutboundBackgroundDispatchResult(
  transportMode: MailOutboundTransportMode,
): OutboundBackgroundDispatchResult {
  return {
    counters: emptyCounters(),
    transportMode,
    dispatchSkipped: !isOutboundTransportDispatchAllowed(transportMode),
  };
}
