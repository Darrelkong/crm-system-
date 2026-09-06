export const dynamic = "force-dynamic";

import { requireAdmin, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { listCollaborationReminderCandidates } from "@/lib/customers/collaboration-reminders";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const candidates = await listCollaborationReminderCandidates(getDb());
    return Response.json({ ok: true, candidates });
  } catch (error) {
    return authErrorResponse(error);
  }
}
