export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor, type MailRouteActorResolver } from "@/lib/mail/api-helpers";
import { parseJsonRecord } from "@/lib/mail/api-helpers";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  finalizeLargeAttachmentUpload,
  type LargeAttachmentFinalizePorts,
} from "@/lib/mail/large-attachment/large-attachment-upload-finalize-service";

export type LargeAttachmentFinalizeRouteDeps = {
  requireMailActor: MailRouteActorResolver;
  finalizePorts?: LargeAttachmentFinalizePorts;
};

const defaultDeps: LargeAttachmentFinalizeRouteDeps = {
  requireMailActor,
};

type RouteContext = { params: Promise<{ id: string; sessionId: string }> };

export async function handlePostLargeAttachmentFinalize(
  request: Request,
  draftId: string,
  sessionId: string,
  deps: LargeAttachmentFinalizeRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { actor, db } = await deps.requireMailActor(request);
    const body = parseJsonRecord(await request.json());
    const versionRaw = body.expectedAutosaveVersion;
    const expectedAutosaveVersion =
      typeof versionRaw === "number"
        ? versionRaw
        : typeof versionRaw === "string"
          ? Number(versionRaw)
          : NaN;

    if (!Number.isInteger(expectedAutosaveVersion)) {
      return Response.json(
        {
          error: "expectedAutosaveVersion is required",
          errorCode: "VALIDATION",
        },
        { status: 400 },
      );
    }

    const item = await finalizeLargeAttachmentUpload(db, actor, {
      draftId,
      sessionId,
      expectedAutosaveVersion,
      ports: deps.finalizePorts,
    });

    return Response.json({ item });
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return mailErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id: draftId, sessionId } = await context.params;
  return handlePostLargeAttachmentFinalize(request, draftId, sessionId);
}
