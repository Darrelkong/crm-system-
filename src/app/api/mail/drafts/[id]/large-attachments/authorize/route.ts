export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor, type MailRouteActorResolver } from "@/lib/mail/api-helpers";
import { parseJsonRecord, readStringField } from "@/lib/mail/api-helpers";
import { mailErrorResponse } from "@/lib/mail/errors";
import { authorizeLargeAttachmentUpload, type LargeAttachmentAuthorizePorts } from "@/lib/mail/large-attachment/large-attachment-upload-authorization-service";

export type LargeAttachmentAuthorizeRouteDeps = {
  requireMailActor: MailRouteActorResolver;
  authorizePorts?: LargeAttachmentAuthorizePorts;
};

const defaultDeps: LargeAttachmentAuthorizeRouteDeps = {
  requireMailActor,
};

type RouteContext = { params: Promise<{ id: string }> };

export async function handlePostLargeAttachmentAuthorize(
  request: Request,
  draftId: string,
  deps: LargeAttachmentAuthorizeRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { actor, db } = await deps.requireMailActor(request);
    const body = parseJsonRecord(await request.json());

    const filename = readStringField(body, "filename");
    const mimeType = readStringField(body, "mimeType") ?? "application/octet-stream";
    const declaredSha256 =
      readStringField(body, "declaredSha256") ??
      readStringField(body, "declaredContentHash");
    const contentMd5 = readStringField(body, "contentMd5");
    const sizeRaw = body.sizeBytes;

    if (!filename || !declaredSha256 || !contentMd5) {
      return Response.json(
        {
          error:
            "filename, sizeBytes, declaredSha256, and contentMd5 are required",
          errorCode: "VALIDATION",
        },
        { status: 400 },
      );
    }

    const sizeBytes =
      typeof sizeRaw === "number"
        ? sizeRaw
        : typeof sizeRaw === "string"
          ? Number(sizeRaw)
          : NaN;
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      return Response.json(
        { error: "sizeBytes must be a positive integer", errorCode: "VALIDATION" },
        { status: 400 },
      );
    }

    const authorization = await authorizeLargeAttachmentUpload(db, actor, {
      draftId,
      authorize: {
        filename,
        mimeType,
        sizeBytes,
        declaredSha256,
        contentMd5,
      },
      ports: deps.authorizePorts,
    });

    return Response.json({
      uploadSessionId: authorization.uploadSessionId,
      uploadUrl: authorization.uploadUrl,
      requiredHeaders: authorization.requiredHeaders,
      expiresAt: authorization.expiresAt,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return mailErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id: draftId } = await context.params;
  return handlePostLargeAttachmentAuthorize(request, draftId);
}
