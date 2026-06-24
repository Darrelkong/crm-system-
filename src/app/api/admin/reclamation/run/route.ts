export const dynamic = "force-dynamic";

import { requireAdmin, authErrorResponse } from "@/lib/permissions/auth";
import { runReclamationJob } from "@/lib/reclamation/run";

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const result = await runReclamationJob();
    return Response.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
