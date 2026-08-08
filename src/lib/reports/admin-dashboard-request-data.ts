import type { Database } from "@/lib/db";
import { collectReclamationRiskSnapshots } from "@/lib/reclamation/work-items-sync";
import type { ReclamationRiskSnapshot } from "@/lib/reclamation/risk-snapshot";
import { getEffectiveSettings, type EffectiveSettings } from "@/lib/settings/effective";
import {
  recordAdminDashboardRequestReclamationSnapshotLoad,
  recordAdminDashboardRequestSettingsLoad,
} from "./admin-dashboard-request-instrumentation";

export type AdminDashboardRequestData = {
  now: Date;
  settings: EffectiveSettings;
  reclamationSnapshots?: ReclamationRiskSnapshot[];
  reclamationSnapshotsFailed?: boolean;
};

/**
 * Load settings and reclamation snapshots once per Admin Dashboard SSR request.
 * Explicit parameter injection — not module-global or cross-request cache.
 */
export async function loadAdminDashboardRequestData(
  db: Database,
  now: Date = new Date(),
): Promise<AdminDashboardRequestData> {
  recordAdminDashboardRequestSettingsLoad();
  const settings = await getEffectiveSettings(db);

  try {
    recordAdminDashboardRequestReclamationSnapshotLoad();
    const reclamationSnapshots = await collectReclamationRiskSnapshots(
      db,
      now,
      settings,
    );
    return { now, settings, reclamationSnapshots };
  } catch (error) {
    console.error("[admin-dashboard-request] reclamation snapshots failed", {
      error,
    });
    return {
      now,
      settings,
      reclamationSnapshotsFailed: true,
    };
  }
}
