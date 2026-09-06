export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor, type MailRouteActorResolver } from "@/lib/mail/api-helpers";
import { MailServiceError, mailErrorResponse } from "@/lib/mail/errors";
import { requireAuthorDraft } from "@/lib/mail/draft-service";
import {
  getLargeAttachmentsR2Bucket,
} from "@/lib/mail/large-attachment/large-attachment-r2-env";
import {
  findLargeAttachmentAcknowledgementForSession,
  findUploadSessionById,
} from "@/lib/mail/large-attachment/large-attachment-upload-repository";
import {
  assertDraftAuthorizedForLargeAttachmentSession,
} from "@/lib/mail/large-attachment/large-attachment-upload-authorization-service";
import {
  isLocalLargeAttachmentRelayEnabled,
  resolveLocalLargeAttachmentRelayTarget,
  streamLocalLargeAttachmentUpload,
  type LocalLargeAttachmentBucket,
} from "@/lib/mail/large-attachment/large-attachment-local-upload-relay";
import {
  isValidLargeAttachmentAcknowledgement,
} from "@/lib/mail/large-attachment/large-attachment-risk-acknowledgement";

export type LargeAttachmentLocalUploadRouteDeps = {
  requireMailActor: MailRouteActorResolver;
  bucket?: LocalLargeAttachmentBucket;
  localRelayEnabled?: boolean;
  trustNow?: () => Date;
};

const defaultDeps: LargeAttachmentLocalUploadRouteDeps = {
  requireMailActor,
};

type RouteContext = { params: Promise<{ id: string; sessionId: string }> };

export async function handlePutLocalLargeAttachmentUpload(
  request: Request,
  draftId: string,
  sessionId: string,
  deps: LargeAttachmentLocalUploadRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const localRelayEnabled =
      deps.localRelayEnabled ?? isLocalLargeAttachmentRelayEnabled();
    if (!localRelayEnabled) {
      throw MailServiceError.notFound("Local large attachment relay is disabled");
    }
    const relayTarget = resolveLocalLargeAttachmentRelayTarget();
    if (!relayTarget) {
      throw MailServiceError.validation(
        "Local large attachment relay is not configured",
        { issueCode: "LOCAL_RELAY_NOT_READY" },
      );
    }

    const { actor, db } = await deps.requireMailActor(request);
    const draft = await requireAuthorDraft(db, actor, draftId);
    const session = await findUploadSessionById(db, sessionId);
    if (!session || session.draftId !== draft.id) {
      throw MailServiceError.notFound("Upload session not found");
    }
    if (session.mailboxId !== draft.mailboxId) {
      throw MailServiceError.validation("Upload session mailbox mismatch");
    }
    if (session.finalizedAt) {
      throw MailServiceError.conflict("Upload session is already finalized");
    }

    const now = deps.trustNow?.() ?? new Date();
    await assertDraftAuthorizedForLargeAttachmentSession(db, actor, {
      draftId,
      session,
      trustNowIso: now.toISOString(),
    });

    const acknowledgement = await findLargeAttachmentAcknowledgementForSession(
      db,
      { sessionId: session.id, userId: actor.userId },
    );
    if (
      !isValidLargeAttachmentAcknowledgement(
        acknowledgement
          ? {
              acknowledged: true,
              noticeVersion: acknowledgement.noticeVersion,
            }
          : null,
      )
    ) {
      throw MailServiceError.validation(
        "Large attachment risk acknowledgement is required",
        { issueCode: "ACKNOWLEDGEMENT_REQUIRED" },
      );
    }

    const bucket = deps.bucket ?? getLargeAttachmentsR2Bucket();
    if (!bucket) {
      throw MailServiceError.validation(
        "Local large attachment R2 binding is not available",
        { issueCode: "LOCAL_R2_NOT_READY" },
      );
    }

    await streamLocalLargeAttachmentUpload({
      request,
      bucket,
      session,
      relayTarget,
    });
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return mailErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { id: draftId, sessionId } = await context.params;
  return handlePutLocalLargeAttachmentUpload(request, draftId, sessionId);
}
