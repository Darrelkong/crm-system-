export const dynamic = "force-dynamic";

import { authErrorResponse, AuthError } from "@/lib/permissions/auth";
import { requireMailActor } from "@/lib/mail/api-helpers";
import { MailServiceError, mailErrorResponse } from "@/lib/mail/errors";
import { lookupMailCustomerByEmail } from "@/lib/mail/mail-customer-lookup-service";
import { assertMailAccessEnabled } from "@/lib/permissions/mail";

export async function GET(request: Request) {
  try {
    const { user, actor, db } = await requireMailActor(request);
    assertMailAccessEnabled(actor);

    const email = new URL(request.url).searchParams.get("email")?.trim();
    if (!email) {
      throw MailServiceError.validation("email query parameter is required");
    }

    const result = await lookupMailCustomerByEmail(db, user, email);
    return Response.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    return mailErrorResponse(error);
  }
}
