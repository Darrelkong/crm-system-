export const dynamic = "force-dynamic";

import { getDb, type Database } from "@/lib/db";
import {
  authErrorResponse,
  requireAdmin,
} from "@/lib/permissions/auth";
import {
  AiEffectStatsRequestError,
  getAiEffectStatsForAdmin,
} from "@/lib/ai/customer-insights/ai-effect-stats-api";
import { AiEffectStatsDataLimitError } from "@/lib/ai/customer-insights/ai-effect-stats";
import type { AiEffectStatsResponse } from "@/lib/ai/customer-insights/ai-effect-stats-response";
import type { User } from "../../../../../drizzle/schema/users";

export type AdminAiEffectStatsRouteDeps = {
  requireAdmin: (request: Request) => Promise<User>;
  getAiEffectStatsForAdmin: (
    db: Database,
    user: User,
    url: URL,
  ) => Promise<AiEffectStatsResponse>;
  getDb: () => Database;
};

function defaultDeps(): AdminAiEffectStatsRouteDeps {
  return {
    requireAdmin: (request) => requireAdmin(request),
    getAiEffectStatsForAdmin,
    getDb,
  };
}

export async function handleAdminAiEffectStatsGet(
  request: Request,
  deps: AdminAiEffectStatsRouteDeps = defaultDeps(),
): Promise<Response> {
  try {
    const user = await deps.requireAdmin(request);
    const db = deps.getDb();
    const result = await deps.getAiEffectStatsForAdmin(
      db,
      user,
      new URL(request.url),
    );
    return Response.json(result);
  } catch (error) {
    if (error instanceof AiEffectStatsRequestError) {
      return Response.json(
        { ok: false, error: error.message, errorCode: error.code },
        { status: error.status },
      );
    }
    if (error instanceof AiEffectStatsDataLimitError) {
      return Response.json(
        { ok: false, error: error.message, errorCode: error.code },
        { status: error.status },
      );
    }
    return authErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleAdminAiEffectStatsGet(request);
}
