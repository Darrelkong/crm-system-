import type { Database } from "@/lib/db";
import { MailServiceError } from "@/lib/mail/errors";
import { materializeAcceptedOutboundSend } from "@/lib/mail/sent-message-materialization-service";
import type { MailBackgroundTickCategoryCounters } from "@/lib/mail/mail-background-tick-service";

export type OutboundSentMaterializationItem = {
  id: string;
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

export async function processOutboundSentMaterializationItem(
  db: Database,
  item: OutboundSentMaterializationItem,
): Promise<"completed" | "skipped" | "error"> {
  try {
    await materializeAcceptedOutboundSend(db, item.id);
    return "completed";
  } catch (error) {
    if (error instanceof MailServiceError) {
      if (
        error.errorCode === "VALIDATION" ||
        error.errorCode === "INTEGRITY_CONFLICT"
      ) {
        return "skipped";
      }
    }
    return "error";
  }
}

export function createOutboundSentMaterializationCounters(): MailBackgroundTickCategoryCounters {
  return emptyCounters();
}
