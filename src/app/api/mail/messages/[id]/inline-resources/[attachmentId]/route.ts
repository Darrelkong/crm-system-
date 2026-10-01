export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor, type MailRouteActorResolver } from "@/lib/mail/api-helpers";
import { getAttachmentsBucket } from "@/lib/mail/attachments-env";
import { MailAttachmentByteIntegrityError, MailAttachmentObjectNotFoundError, MailAttachmentR2OperationalError, R2MailAttachmentByteReader, type MailAttachmentByteReader } from "@/lib/mail/mail-attachment-byte-reader";
import { buildMailAttachmentDownloadResponse } from "@/lib/mail/mail-attachment-download-response";
import { resolveMailInlineResource, validatedInlineImageType } from "@/lib/mail/mail-inline-resource-service";
import { parseOptionalMessageReadFolder, parseRequiredAttachmentId, parseRequiredMessageId } from "@/lib/mail/mail-read-api-parsing";
import { mailErrorResponse } from "@/lib/mail/errors";

type Deps = { requireMailActor: MailRouteActorResolver; createByteReader: () => MailAttachmentByteReader };
const defaultDeps: Deps = { requireMailActor, createByteReader: () => new R2MailAttachmentByteReader(getAttachmentsBucket()) };

export async function handleGetMailInlineResource(request: Request, messageId: string, attachmentId: string, deps: Deps = defaultDeps): Promise<Response> {
  try {
    const { actor, db } = await deps.requireMailActor(request);
    const folder = parseOptionalMessageReadFolder(new URL(request.url).searchParams);
    const resource = await resolveMailInlineResource(db, actor, parseRequiredMessageId(messageId), parseRequiredAttachmentId(attachmentId), folder ? { folder } : undefined);
    const bytes = await deps.createByteReader().read(resource.storageKey, resource.sizeBytes);
    const contentType = validatedInlineImageType(bytes, resource.mimeType);
    if (!contentType) return Response.json({ errorCode: "INLINE_IMAGE_UNAVAILABLE" }, { status: 415, headers: { "Cache-Control": "private, no-store" } });
    return buildMailAttachmentDownloadResponse(bytes, resource, { disposition: "inline", contentType });
  } catch (error) {
    const response = error instanceof AuthError ? authErrorResponse(error)
      : error instanceof MailAttachmentObjectNotFoundError || error instanceof MailAttachmentByteIntegrityError
        ? Response.json({ errorCode: "INLINE_IMAGE_UNAVAILABLE" }, { status: 404 })
        : error instanceof MailAttachmentR2OperationalError
          ? Response.json({ errorCode: "SERVER_ERROR" }, { status: 500 }) : mailErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await context.params;
  return handleGetMailInlineResource(request, id, attachmentId);
}
