type WorkItemsInstrumentation = {
  workItemTaskCountPhysicalLoads: number;
  workItemSettingsPhysicalLoads: number;
  workItemOpenBadgePhysicalLoads: number;
};

const instrumentation: WorkItemsInstrumentation = {
  workItemTaskCountPhysicalLoads: 0,
  workItemSettingsPhysicalLoads: 0,
  workItemOpenBadgePhysicalLoads: 0,
};

/** Test-only: reset work-items physical-load counters. */
export function resetWorkItemsInstrumentation(): void {
  instrumentation.workItemTaskCountPhysicalLoads = 0;
  instrumentation.workItemSettingsPhysicalLoads = 0;
  instrumentation.workItemOpenBadgePhysicalLoads = 0;
}

/** Test-only: read work-items physical-load counters. */
export function getWorkItemsInstrumentation(): Readonly<WorkItemsInstrumentation> {
  return instrumentation;
}

export function recordWorkItemTaskCountPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.workItemTaskCountPhysicalLoads += 1;
  }
}

export function recordWorkItemSettingsPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.workItemSettingsPhysicalLoads += 1;
  }
}

export function recordWorkItemOpenBadgePhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.workItemOpenBadgePhysicalLoads += 1;
  }
}
