export const dynamic = "force-dynamic";

import { requireMailActor, parseJsonRecord, readStringField } from "@/lib/mail/api-helpers";
import { mailErrorResponse, MailServiceError } from "@/lib/mail/errors";
import {
  acknowledgeUncertainSend,
  getLargeAttachmentOperationalSendView,
  revokeLargeAttachmentCapabilities,
} from "@/lib/mail/large-attachment/large-attachment-operational-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const item = await getLargeAttachmentOperationalSendView(db, actor, id);
    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const body = parseJsonRecord(await request.json().catch(() => null));
    const action = readStringField(body, "action");

    if (action === "acknowledge") {
      await acknowledgeUncertainSend(db, actor, id);
      return Response.json({ acknowledged: true });
    }
    if (action === "revoke_large_attachment_capabilities") {
      const result = await revokeLargeAttachmentCapabilities(db, actor, id);
      return Response.json(result);
    }
    throw MailServiceError.validation("Unsupported operational action");
  } catch (error) {
    return mailErrorResponse(error);
  }
}
