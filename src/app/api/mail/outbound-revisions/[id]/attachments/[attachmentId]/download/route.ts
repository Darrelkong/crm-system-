export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor, type MailRouteActorResolver } from "@/lib/mail/api-helpers";
import {
  MailAttachmentByteIntegrityError,
  MailAttachmentObjectNotFoundError,
  MailAttachmentR2OperationalError,
  R2MailAttachmentByteReader,
  type MailAttachmentByteReader,
} from "@/lib/mail/mail-attachment-byte-reader";
import { buildMailAttachmentDownloadResponse } from "@/lib/mail/mail-attachment-download-response";
import { recordOutboundRevisionAttachmentDownloaded } from "@/lib/mail/mail-attachment-download-audit";
import { getAttachmentsBucket } from "@/lib/mail/attachments-env";
import { getLargeAttachmentsR2Bucket } from "@/lib/mail/large-attachment/large-attachment-r2-env";
import { MailServiceError, mailErrorResponse } from "@/lib/mail/errors";
import { resolveMailAttachmentPreviewContentType } from "@/lib/mail/mail-attachment-preview";
import { resolveDownloadableOutboundRevisionAttachment } from "@/lib/mail/outbound-revision-attachment-download-service";

export type OutboundRevisionAttachmentDownloadRouteDeps = {
  requireMailActor: MailRouteActorResolver;
  createDirectByteReader: () => MailAttachmentByteReader;
  createLargeByteReader: () => MailAttachmentByteReader | null;
};

const defaultDeps: OutboundRevisionAttachmentDownloadRouteDeps = {
  requireMailActor,
  createDirectByteReader: () => new R2MailAttachmentByteReader(getAttachmentsBucket()),
  createLargeByteReader: () => {
    const bucket = getLargeAttachmentsR2Bucket();
    return bucket ? new R2MailAttachmentByteReader(bucket) : null;
  },
};

type RouteContext = { params: Promise<{ id: string; attachmentId: string }> };

export async function handleGetOutboundRevisionAttachmentDownload(
  request: Request,
  revisionId: string,
  attachmentId: string,
  deps: OutboundRevisionAttachmentDownloadRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { actor, db } = await deps.requireMailActor(request);
    const downloadable = await resolveDownloadableOutboundRevisionAttachment(
      db,
      actor,
      revisionId,
      attachmentId,
    );

    const byteReader =
      downloadable.deliveryMode === "large_attachment"
        ? deps.createLargeByteReader()
        : deps.createDirectByteReader();
    if (!byteReader) {
      return Response.json(
        { error: "Large attachment storage is unavailable", errorCode: "SERVER_ERROR" },
        { status: 503 },
      );
    }

    const bytes = await byteReader.read(
      downloadable.storageKey,
      downloadable.sizeBytes,
    );

    const requestedDisposition = new URL(request.url).searchParams
      .get("disposition")
      ?.trim();
    const disposition =
      requestedDisposition == null || requestedDisposition === ""
        ? "attachment"
        : requestedDisposition === "inline" ||
            requestedDisposition === "attachment"
          ? requestedDisposition
          : (() => {
              throw MailServiceError.validation(
                "disposition must be inline or attachment",
              );
            })();
    const preview =
      disposition === "inline"
        ? resolveMailAttachmentPreviewContentType({
            bytes,
            mimeType: downloadable.mimeType,
            filename: downloadable.filename,
          })
        : null;
    if (disposition === "inline" && !preview) {
      return Response.json(
        {
          error: "無法在此裝置預覽此附件",
          errorCode: "ATTACHMENT_PREVIEW_NOT_SUPPORTED",
        },
        { status: 415 },
      );
    }

    await recordOutboundRevisionAttachmentDownloaded(db, actor, downloadable);

    return buildMailAttachmentDownloadResponse(bytes, downloadable, {
      disposition,
      contentType: preview?.contentType,
    });
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

export async function GET(request: Request, context: RouteContext) {
  const { id: revisionId, attachmentId } = await context.params;
  return handleGetOutboundRevisionAttachmentDownload(
    request,
    revisionId,
    attachmentId,
  );
}
