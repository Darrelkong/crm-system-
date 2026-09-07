import type { MailOutboundRevision } from "../../../../drizzle/schema/mail-outbound-revisions";
import type { Database } from "@/lib/db";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { assertLargeAttachmentSendEligible } from "./large-attachment-send-service";

export const LARGE_ATTACHMENT_DOWNLOAD_GATEWAY_BLOCK_CODE =
  "LARGE_ATTACHMENT_DOWNLOAD_GATEWAY_NOT_READY" as const;

export async function assertRevisionHasNoLargeAttachmentsPendingGateway(
  db: Database,
  revisionId: string,
  options?: {
    authorizationMode?: "admin_direct" | "staff_approved";
    sendEnabled?: boolean;
    publicBaseUrl?: string | null;
    trustNowIso?: string;
    env?: Record<string, string | undefined>;
  },
): Promise<{ hasLargeAttachments: boolean }> {
  return assertLargeAttachmentSendEligible(db, {
    revisionId,
    authorizationMode: options?.authorizationMode ?? "admin_direct",
    sendEnabled: options?.sendEnabled,
    publicBaseUrl: options?.publicBaseUrl,
    trustNowIso: options?.trustNowIso,
    env: options?.env,
  });
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
  return attachments.some(
    (attachment) => attachment.deliveryMode === "large_attachment",
  );
}
