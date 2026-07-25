import type { Database } from "@/lib/db";
import type { User } from "../../../../drizzle/schema/users";
import { AuthError } from "@/lib/permissions/auth";
import {
  getAiEffectStats,
  type AiEffectStatsQueryMeter,
} from "@/lib/ai/customer-insights/ai-effect-stats";
import {
  AiEffectStatsRequestError,
  parseAiEffectStatsRequest,
} from "@/lib/ai/customer-insights/ai-effect-stats-request";
import type { AiEffectStatsResponse } from "@/lib/ai/customer-insights/ai-effect-stats-response";

export function assertAdminForAiEffectStats(user: User): void {
  if (user.role !== "admin") {
    throw new AuthError(403, "需要管理员权限", "permission.denied.admin_required");
  }
}

export async function getAiEffectStatsForAdmin(
  db: Database,
  user: User,
  url: URL,
  options?: { now?: Date; queryMeter?: AiEffectStatsQueryMeter },
): Promise<AiEffectStatsResponse> {
  assertAdminForAiEffectStats(user);
  const parsed = parseAiEffectStatsRequest(url, options?.now ?? new Date());
  return getAiEffectStats(db, parsed, { queryMeter: options?.queryMeter });
}

export { AiEffectStatsRequestError };
