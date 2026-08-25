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

function mapAttachmentStorageError(error: unknown): Response {
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

export async function handleGetMailAttachmentDownload(
  request: Request,
  attachmentId: string,
  deps: MailAttachmentDownloadRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { actor, db } = await deps.requireMailActor(request);
    const normalizedAttachmentId = parseRequiredAttachmentId(attachmentId);
    const folder = parseOptionalMessageReadFolder(new URL(request.url).searchParams);
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

    await recordMailAttachmentDownloaded(db, actor, downloadable);

    return buildMailAttachmentDownloadResponse(bytes, downloadable);
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

export async function GET(request: Request, context: RouteContext) {
  const { attachmentId } = await context.params;
  return handleGetMailAttachmentDownload(request, attachmentId);
}
