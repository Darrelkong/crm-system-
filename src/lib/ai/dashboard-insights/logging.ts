import type { DashboardAiInsightType } from "./types";

export type DashboardAiAuditLogEntry = {
  at: string;
  viewerId: string;
  role: string;
  insightType: DashboardAiInsightType;
  provider?: string;
  model?: string;
  durationMs?: number;
  status: string;
  cacheHit?: boolean;
  fingerprint?: string;
};

export function logDashboardAiAudit(entry: DashboardAiAuditLogEntry): void {
  console.info("[dashboard-ai]", {
    at: entry.at,
    viewerId: entry.viewerId,
    role: entry.role,
    insightType: entry.insightType,
    provider: entry.provider,
    model: entry.model,
    durationMs: entry.durationMs,
    status: entry.status,
    cacheHit: entry.cacheHit ?? false,
    fingerprint: entry.fingerprint,
  });
}
