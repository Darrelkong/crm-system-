import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { NewIncomingNotificationContext } from "@/lib/mail/notification-privacy-renderer";

export const NOTIFICATION_RECEIVED_AT_TIMEZONE = "Asia/Hong_Kong" as const;

export function formatNotificationReceivedAtLocalized(
  receivedAtIso: string,
): string {
  const date = new Date(receivedAtIso);
  if (Number.isNaN(date.getTime())) {
    return receivedAtIso;
  }
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: NOTIFICATION_RECEIVED_AT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatNotificationSenderDisplay(
  fromAddress: string,
  fromDisplayName: string | null | undefined,
): string {
  const address = fromAddress.trim();
  const display = fromDisplayName?.trim();
  if (display && display.length > 0) {
    return `${display} <${address}>`;
  }
  return address;
}

export async function loadNewIncomingNotificationContext(
  db: Database,
  input: {
    sourceEntityId: string;
    mailboxId: string | null;
  },
): Promise<NewIncomingNotificationContext | null> {
  const [message] = await db
    .select({
      fromAddress: schema.mailMessages.fromAddress,
      fromDisplayName: schema.mailMessages.fromDisplayName,
      subject: schema.mailMessages.subject,
      receivedAt: schema.mailMessages.receivedAt,
      mailboxId: schema.mailMessages.mailboxId,
    })
    .from(schema.mailMessages)
    .where(eq(schema.mailMessages.id, input.sourceEntityId))
    .limit(1);

  if (!message) {
    return null;
  }

  const mailboxId = input.mailboxId ?? message.mailboxId;
  let mailboxAddress = "";
  if (mailboxId) {
    const [primary] = await db
      .select({ address: schema.mailReceivingAddresses.address })
      .from(schema.mailReceivingAddresses)
      .where(
        and(
          eq(schema.mailReceivingAddresses.mailboxId, mailboxId),
          eq(schema.mailReceivingAddresses.addressType, "primary"),
          eq(schema.mailReceivingAddresses.status, "active"),
        ),
      )
      .limit(1);
    mailboxAddress = primary?.address ?? "";
    if (!mailboxAddress) {
      const [mailbox] = await db
        .select({ address: schema.mailMailboxes.address })
        .from(schema.mailMailboxes)
        .where(eq(schema.mailMailboxes.id, mailboxId))
        .limit(1);
      mailboxAddress = mailbox?.address ?? "";
    }
  }

  const receivedAt = message.receivedAt ?? new Date().toISOString();
  return {
    mailboxAddress: mailboxAddress || "（未知）",
    senderDisplay: formatNotificationSenderDisplay(
      message.fromAddress,
      message.fromDisplayName,
    ),
    subject: message.subject.trim() || "（無主旨）",
    receivedAtLocalized: formatNotificationReceivedAtLocalized(receivedAt),
  };
}
