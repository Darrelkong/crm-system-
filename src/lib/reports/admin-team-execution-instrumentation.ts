type TeamExecutionPeriodInstrumentation = {
  teamFollowUpPeriodPhysicalLoads: number;
  teamStagePeriodPhysicalLoads: number;
};

const instrumentation: TeamExecutionPeriodInstrumentation = {
  teamFollowUpPeriodPhysicalLoads: 0,
  teamStagePeriodPhysicalLoads: 0,
};

/** Test-only: reset team period physical-load counters. */
export function resetAdminTeamExecutionPeriodInstrumentation(): void {
  instrumentation.teamFollowUpPeriodPhysicalLoads = 0;
  instrumentation.teamStagePeriodPhysicalLoads = 0;
}

/** Test-only: read team period physical-load counters. */
export function getAdminTeamExecutionPeriodInstrumentation(): Readonly<TeamExecutionPeriodInstrumentation> {
  return instrumentation;
}

export function recordTeamFollowUpPeriodPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.teamFollowUpPeriodPhysicalLoads += 1;
  }
}

export function recordTeamStagePeriodPhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.teamStagePeriodPhysicalLoads += 1;
  }
}
