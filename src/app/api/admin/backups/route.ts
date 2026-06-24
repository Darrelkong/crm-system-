export const dynamic = "force-dynamic";

import { listBackupJobs } from "@/lib/backup/queries";
import { getDb } from "@/lib/db";
import { requireBackupAdmin } from "@/lib/permissions/backup";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    await requireBackupAdmin(request);
    const items = await listBackupJobs(getDb(), 50);
    return Response.json({ items, total: items.length });
  } catch (error) {
    return authErrorResponse(error);
  }
}
