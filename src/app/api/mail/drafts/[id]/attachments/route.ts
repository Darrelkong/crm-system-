export const dynamic = "force-dynamic";

import {
  MAIL_ATTACHMENTS_R2_BUCKET_NAME,
  getAttachmentsBucket,
} from "@/lib/mail/attachments-env";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { MAIL_COMPOSE_ATTACHMENT_UPLOAD_MAX_BYTES } from "@/lib/mail/constants";
import { addDraftAttachment } from "@/lib/mail/draft-attachment-service";
import { mailErrorResponse } from "@/lib/mail/errors";
import { createOutboundAttachmentStore } from "@/lib/mail/outbound-attachment-store";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id: draftId } = await context.params;

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAIL_COMPOSE_ATTACHMENT_UPLOAD_MAX_BYTES
    ) {
      return Response.json(
        {
          error: "Attachment upload exceeds maximum request size",
          errorCode: "VALIDATION",
        },
        { status: 413 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const versionRaw = formData.get("expectedAutosaveVersion");
    const expectedAutosaveVersion =
      typeof versionRaw === "string" ? Number(versionRaw) : Number(versionRaw);

    if (!(file instanceof File)) {
      return Response.json(
        { error: "file is required", errorCode: "VALIDATION" },
        { status: 400 },
      );
    }
    if (!Number.isInteger(expectedAutosaveVersion)) {
      return Response.json(
        {
          error: "expectedAutosaveVersion is required",
          errorCode: "VALIDATION",
        },
        { status: 400 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const attachmentStore = createOutboundAttachmentStore(
      getAttachmentsBucket(),
      MAIL_ATTACHMENTS_R2_BUCKET_NAME,
    );

    const item = await addDraftAttachment(db, actor, attachmentStore, {
      draftId,
      expectedAutosaveVersion,
      bytes,
      originalFilename: file.name,
      mimeType: file.type || "application/octet-stream",
    });

    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
