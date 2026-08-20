export const dynamic = "force-dynamic";

import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import { mailErrorResponse } from "@/lib/mail/errors";
import { parseJsonRecord, requireMailActor } from "@/lib/mail/api-helpers";
import { withdrawApproval } from "@/lib/mail/outbound-approval-service";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const bodyResult = await readLimitedJsonBody(
      request,
      MAIL_API_MAX_JSON_BYTES,
    );
    if (!bodyResult.ok) {
      return Response.json(
        { error: bodyResult.message, errorCode: bodyResult.errorCode },
        { status: bodyResult.httpStatus },
      );
    }
    const body = parseJsonRecord(bodyResult.value);
    const expectedWorkflowVersion = body.expectedWorkflowVersion;
    if (typeof expectedWorkflowVersion !== "number") {
      return Response.json(
        {
          error: "expectedWorkflowVersion is required",
          errorCode: "VALIDATION",
        },
        { status: 400 },
      );
    }

    const item = await withdrawApproval(db, actor, {
      approvalId: id,
      expectedWorkflowVersion,
    });
    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
