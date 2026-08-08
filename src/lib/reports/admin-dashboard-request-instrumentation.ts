type DashboardRequestInstrumentation = {
  settingsPhysicalLoads: number;
  reclamationSnapshotPhysicalLoads: number;
};

const instrumentation: DashboardRequestInstrumentation = {
  settingsPhysicalLoads: 0,
  reclamationSnapshotPhysicalLoads: 0,
};

/** Test-only: reset physical-load counters between assertions. */
export function resetAdminDashboardRequestInstrumentation(): void {
  instrumentation.settingsPhysicalLoads = 0;
  instrumentation.reclamationSnapshotPhysicalLoads = 0;
}

/** Test-only: read physical-load counters (no production logging). */
export function getAdminDashboardRequestInstrumentation(): Readonly<DashboardRequestInstrumentation> {
  return instrumentation;
}

export function recordAdminDashboardSettingsPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.settingsPhysicalLoads += 1;
  }
}

export function recordAdminDashboardReclamationSnapshotPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.reclamationSnapshotPhysicalLoads += 1;
  }
}

export function recordAdminDashboardRequestSettingsLoad(): void {
  instrumentation.settingsPhysicalLoads += 1;
}

export function recordAdminDashboardRequestReclamationSnapshotLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.reclamationSnapshotPhysicalLoads += 1;
  }
}
