export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor } from "@/lib/mail/api-helpers";
import {
  MailAttachmentByteIntegrityError,
  MailAttachmentObjectNotFoundError,
  MailAttachmentR2OperationalError,
  R2MailAttachmentByteReader,
} from "@/lib/mail/mail-attachment-byte-reader";
import { buildMailAttachmentDownloadResponse } from "@/lib/mail/mail-attachment-download-response";
import { getAttachmentsBucket } from "@/lib/mail/attachments-env";
import { MailServiceError, mailErrorResponse } from "@/lib/mail/errors";
import { resolveDownloadableOutboundRevisionAttachment } from "@/lib/mail/outbound-revision-attachment-download-service";

type RouteContext = {
  params: Promise<{ id: string; attachmentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id: revisionId, attachmentId } = await context.params;
    const downloadable = await resolveDownloadableOutboundRevisionAttachment(
      db,
      actor,
      revisionId,
      attachmentId,
    );

    const byteReader = new R2MailAttachmentByteReader(getAttachmentsBucket());
    const bytes = await byteReader.read(
      downloadable.storageKey,
      downloadable.sizeBytes,
    );

    return buildMailAttachmentDownloadResponse(bytes, downloadable);
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    if (
      error instanceof MailAttachmentObjectNotFoundError ||
      error instanceof MailAttachmentByteIntegrityError
    ) {
      return mailErrorResponse(MailServiceError.notFound());
    }
    if (error instanceof MailAttachmentR2OperationalError) {
      return Response.json(
        { error: "服务器错误", errorCode: "SERVER_ERROR" },
        { status: 500 },
      );
    }
    return mailErrorResponse(error);
  }
}
