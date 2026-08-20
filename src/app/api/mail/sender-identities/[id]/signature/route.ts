export const dynamic = "force-dynamic";

import { mailErrorResponse } from "@/lib/mail/errors";
import { requireMailActor } from "@/lib/mail/api-helpers";
import {
  getCurrentSignatureForIdentity,
  getEffectiveSignatureForAuthorizedSender,
} from "@/lib/mail/signature-service";
import { hasAnyMailAdminGrant } from "@/lib/permissions/mail";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const isSignatureAdmin = hasAnyMailAdminGrant(actor, [
      "super_admin",
      "signature_template",
    ]);
    const item = isSignatureAdmin
      ? await getCurrentSignatureForIdentity(db, actor, id)
      : await getEffectiveSignatureForAuthorizedSender(db, actor, id);
    return Response.json({ item });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
