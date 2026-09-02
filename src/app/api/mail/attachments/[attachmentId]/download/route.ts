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
import { recordMailAttachmentDownloaded } from "@/lib/mail/mail-attachment-download-audit";
import { resolveDownloadableMailAttachment } from "@/lib/mail/mail-attachment-download-service";
import { buildMailAttachmentDownloadResponse } from "@/lib/mail/mail-attachment-download-response";
import { resolveMailAttachmentPreviewContentType } from "@/lib/mail/mail-attachment-preview";
import { getAttachmentsBucket } from "@/lib/mail/attachments-env";
import { MailServiceError, mailErrorResponse } from "@/lib/mail/errors";
import {
  parseOptionalMessageReadFolder,
  parseRequiredAttachmentId,
} from "@/lib/mail/mail-read-api-parsing";

export type MailAttachmentDownloadRouteDeps = {
  requireMailActor: MailRouteActorResolver;
  createByteReader: () => MailAttachmentByteReader;
};

const defaultDeps: MailAttachmentDownloadRouteDeps = {
  requireMailActor,
  createByteReader: () => new R2MailAttachmentByteReader(getAttachmentsBucket()),
};

type RouteContext = { params: Promise<{ attachmentId: string }> };

export type MailAttachmentContentDisposition = "inline" | "attachment";

function mapAttachmentStorageError(error: unknown): Response {
  if (
    error instanceof MailAttachmentObjectNotFoundError ||
    error instanceof MailAttachmentByteIntegrityError
  ) {
    return Response.json(
      {
        error: "目前無法取得此附件",
        errorCode: "ATTACHMENT_OBJECT_MISSING",
      },
      { status: 404 },
    );
  }
  if (error instanceof MailAttachmentR2OperationalError) {
    return Response.json(
      { error: "服务器错误", errorCode: "SERVER_ERROR" },
      { status: 500 },
    );
  }
  return mailErrorResponse(error);
}

export async function handleGetMailAttachmentContent(
  request: Request,
  attachmentId: string,
  deps: MailAttachmentDownloadRouteDeps = defaultDeps,
  defaultDisposition: MailAttachmentContentDisposition = "attachment",
): Promise<Response> {
  try {
    const { actor, db } = await deps.requireMailActor(request);
    const normalizedAttachmentId = parseRequiredAttachmentId(attachmentId);
    const searchParams = new URL(request.url).searchParams;
    const folder = parseOptionalMessageReadFolder(searchParams);
    const requestedDisposition = searchParams.get("disposition")?.trim();
    const disposition =
      requestedDisposition == null || requestedDisposition === ""
        ? defaultDisposition
        : requestedDisposition === "inline" || requestedDisposition === "attachment"
          ? requestedDisposition
          : (() => {
              throw MailServiceError.validation(
                "disposition must be inline or attachment",
              );
            })();
    const downloadable = await resolveDownloadableMailAttachment(
      db,
      actor,
      normalizedAttachmentId,
      folder ? { folder } : undefined,
    );

    const byteReader = deps.createByteReader();
    const bytes = await byteReader.read(
      downloadable.storageKey,
      downloadable.sizeBytes,
    );

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

    await recordMailAttachmentDownloaded(db, actor, downloadable);

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
      error instanceof MailAttachmentByteIntegrityError ||
      error instanceof MailAttachmentR2OperationalError
    ) {
      return mapAttachmentStorageError(error);
    }
    return mailErrorResponse(error);
  }
}

export const handleGetMailAttachmentDownload = handleGetMailAttachmentContent;

export async function GET(request: Request, context: RouteContext) {
  const { attachmentId } = await context.params;
  return handleGetMailAttachmentDownload(request, attachmentId);
}
