type DashboardRequestInstrumentation = {
  settingsPhysicalLoads: number;
  reclamationSnapshotPhysicalLoads: number;
  sharedKpiPhysicalLoads: number;
  totalCustomersPhysicalLoads: number;
  pendingApprovalsPhysicalLoads: number;
};

const instrumentation: DashboardRequestInstrumentation = {
  settingsPhysicalLoads: 0,
  reclamationSnapshotPhysicalLoads: 0,
  sharedKpiPhysicalLoads: 0,
  totalCustomersPhysicalLoads: 0,
  pendingApprovalsPhysicalLoads: 0,
};

/** Test-only: reset physical-load counters between assertions. */
export function resetAdminDashboardRequestInstrumentation(): void {
  instrumentation.settingsPhysicalLoads = 0;
  instrumentation.reclamationSnapshotPhysicalLoads = 0;
  instrumentation.sharedKpiPhysicalLoads = 0;
  instrumentation.totalCustomersPhysicalLoads = 0;
  instrumentation.pendingApprovalsPhysicalLoads = 0;
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
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.settingsPhysicalLoads += 1;
  }
}

export function recordAdminDashboardRequestReclamationSnapshotLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.reclamationSnapshotPhysicalLoads += 1;
  }
}

export function recordAdminDashboardSharedKpiPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.sharedKpiPhysicalLoads += 1;
  }
}

export function recordAdminDashboardTotalCustomersPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.totalCustomersPhysicalLoads += 1;
  }
}

export function recordAdminDashboardPendingApprovalsPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.pendingApprovalsPhysicalLoads += 1;
  }
}
