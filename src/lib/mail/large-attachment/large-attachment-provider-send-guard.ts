import { eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailOutboundRevision } from "../../../../drizzle/schema/mail-outbound-revisions";
import { MailServiceError } from "@/lib/mail/errors";

export const LARGE_ATTACHMENT_DOWNLOAD_GATEWAY_BLOCK_CODE =
  "LARGE_ATTACHMENT_DOWNLOAD_GATEWAY_NOT_READY" as const;

export async function assertRevisionHasNoLargeAttachmentsPendingGateway(
  db: Database,
  revisionId: string,
): Promise<void> {
  const attachments = await db
    .select({
      deliveryMode: schema.mailOutboundRevisionAttachments.deliveryMode,
    })
    .from(schema.mailOutboundRevisionAttachments)
    .where(eq(schema.mailOutboundRevisionAttachments.revisionId, revisionId));

  if (attachments.some((attachment) => attachment.deliveryMode === "large_attachment")) {
    throw MailServiceError.validation(
      "Outbound send with large attachments is blocked until the download gateway is ready",
      { issueCode: LARGE_ATTACHMENT_DOWNLOAD_GATEWAY_BLOCK_CODE },
    );
  }
}

export async function revisionContainsLargeAttachments(
  db: Database,
  revision: Pick<MailOutboundRevision, "id">,
): Promise<boolean> {
  const attachments = await db
    .select({
      deliveryMode: schema.mailOutboundRevisionAttachments.deliveryMode,
    })
    .from(schema.mailOutboundRevisionAttachments)
    .where(eq(schema.mailOutboundRevisionAttachments.revisionId, revision.id));
  return attachments.some((attachment) => attachment.deliveryMode === "large_attachment");
}
