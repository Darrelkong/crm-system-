import { eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import { normalizeEmailAddress } from "@/lib/mail/canonical-content-hash-v1-contract";

/**
 * Loop prevention: Notification Identity must not equal any mailbox receiving
 * address (primary or alias). Otherwise inbound → notify → inbound loops are possible.
 */
export async function notificationIdentityWouldLoopWithMailboxReceivingAddresses(
  db: Database,
  mailboxId: string,
  identityEmail: string,
): Promise<boolean> {
  const normalizedIdentity = normalizeEmailAddress(identityEmail);
  const addresses = await db
    .select({ address: schema.mailReceivingAddresses.address })
    .from(schema.mailReceivingAddresses)
    .where(eq(schema.mailReceivingAddresses.mailboxId, mailboxId));

  return addresses.some(
    (row) => normalizeEmailAddress(row.address) === normalizedIdentity,
  );
}
