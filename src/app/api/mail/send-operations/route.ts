export const dynamic = "force-dynamic";

import { requireMailActor } from "@/lib/mail/api-helpers";
import { mailErrorResponse } from "@/lib/mail/errors";
import { listOutboxItems, listOutboxPage } from "@/lib/mail/outbox-service";
import {
  parseOptionalCursor,
  parseOptionalMailSearch,
  parseOptionalMailboxScope,
  parseOptionalMessageListLimit,
} from "@/lib/mail/mail-read-api-parsing";

export async function GET(request: Request) {
  try {
    const { actor, db } = await requireMailActor(request);
    const searchParams = new URL(request.url).searchParams;
    const mailboxId = searchParams.get("mailboxId");
    const scope = parseOptionalMailboxScope(searchParams);
    const cursor = parseOptionalCursor(searchParams);
    const limit = parseOptionalMessageListLimit(searchParams);
    const search = parseOptionalMailSearch(searchParams);
    if (
      searchParams.has("scope") ||
      cursor != null ||
      limit != null ||
      search != null
    ) {
      const page = await listOutboxPage(db, actor, {
        scope,
        mailboxId,
        cursor,
        limit,
        search,
      });
      return Response.json(page);
    }
    const items = await listOutboxItems(db, actor, { mailboxId });
    return Response.json({ items });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
