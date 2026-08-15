type PublicPoolInstrumentation = {
  publicPoolSettingsPhysicalLoads: number;
  publicPoolClaimHistoryPhysicalLoads: number;
  publicPoolCustomerListPhysicalLoads: number;
  publicPoolFollowUpPhysicalLoads: number;
};

const instrumentation: PublicPoolInstrumentation = {
  publicPoolSettingsPhysicalLoads: 0,
  publicPoolClaimHistoryPhysicalLoads: 0,
  publicPoolCustomerListPhysicalLoads: 0,
  publicPoolFollowUpPhysicalLoads: 0,
};

/** Test-only: reset public-pool physical-load counters. */
export function resetPublicPoolInstrumentation(): void {
  instrumentation.publicPoolSettingsPhysicalLoads = 0;
  instrumentation.publicPoolClaimHistoryPhysicalLoads = 0;
  instrumentation.publicPoolCustomerListPhysicalLoads = 0;
  instrumentation.publicPoolFollowUpPhysicalLoads = 0;
}

/** Test-only: read public-pool physical-load counters. */
export function getPublicPoolInstrumentation(): Readonly<PublicPoolInstrumentation> {
  return instrumentation;
}

export function recordPublicPoolSettingsPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.publicPoolSettingsPhysicalLoads += 1;
  }
}

export function recordPublicPoolClaimHistoryPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.publicPoolClaimHistoryPhysicalLoads += 1;
  }
}

export function recordPublicPoolCustomerListPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.publicPoolCustomerListPhysicalLoads += 1;
  }
}

export function recordPublicPoolFollowUpPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.publicPoolFollowUpPhysicalLoads += 1;
  }
}
