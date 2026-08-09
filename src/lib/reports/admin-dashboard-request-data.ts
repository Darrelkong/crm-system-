import type { Database } from "@/lib/db";
import { collectReclamationRiskSnapshots } from "@/lib/reclamation/work-items-sync";
import type { ReclamationRiskSnapshot } from "@/lib/reclamation/risk-snapshot";
import { getEffectiveSettings, type EffectiveSettings } from "@/lib/settings/effective";
import {
  recordAdminDashboardRequestReclamationSnapshotLoad,
  recordAdminDashboardRequestSettingsLoad,
} from "./admin-dashboard-request-instrumentation";

export type AdminDashboardReclamationData = {
  reclamationSnapshots?: ReclamationRiskSnapshot[];
  reclamationSnapshotsFailed?: boolean;
};

export type AdminDashboardRequestData = {
  now: Date;
  settings: EffectiveSettings;
} & AdminDashboardReclamationData;

/** Load effective settings once per Admin Dashboard SSR request. */
export async function loadAdminDashboardSharedSettings(
  db: Database,
): Promise<EffectiveSettings> {
  recordAdminDashboardRequestSettingsLoad();
  return getEffectiveSettings(db);
}

/** Load reclamation snapshots once; failures are isolated to summary/team consumers. */
export async function loadAdminDashboardReclamationData(
  db: Database,
  now: Date,
  settings: EffectiveSettings,
): Promise<AdminDashboardReclamationData> {
  recordAdminDashboardRequestReclamationSnapshotLoad();
  try {
    const reclamationSnapshots = await collectReclamationRiskSnapshots(
      db,
      now,
      settings,
    );
    return { reclamationSnapshots };
  } catch (error) {
    console.error("[admin-dashboard-request] reclamation snapshots failed", {
      error,
    });
    return { reclamationSnapshotsFailed: true };
  }
}

/**
 * Load settings and reclamation snapshots sequentially.
 * Prefer `loadAdminDashboardReports` for parallel Admin Dashboard orchestration.
 */
export async function loadAdminDashboardRequestData(
  db: Database,
  now: Date = new Date(),
): Promise<AdminDashboardRequestData> {
  const settings = await loadAdminDashboardSharedSettings(db);
  const reclamationData = await loadAdminDashboardReclamationData(
    db,
    now,
    settings,
  );
  return { now, settings, ...reclamationData };
}
