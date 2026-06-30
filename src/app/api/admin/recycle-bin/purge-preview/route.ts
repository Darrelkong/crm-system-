export const dynamic = "force-dynamic";

import { getDb } from "@/lib/db";
import {
  getRecycleBinPurgePreviewForAdmin,
  parsePurgePreviewLimitParam,
} from "@/lib/recycle-bin/purge-preview-api";
import { requireAdmin, authErrorResponse } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const url = new URL(request.url);
    const limit = parsePurgePreviewLimitParam(url.searchParams.get("limit"));
    const preview = await getRecycleBinPurgePreviewForAdmin(actor, getDb(), {
      limit,
    });

    return Response.json(preview);
  } catch (error) {
    return authErrorResponse(error);
  }
}
