type ScoringSqlInstrumentation = {
  legacyCustomersHydrated: number;
  legacyCustomersScoredInJs: number;
  legacyFollowUpIdsConsidered: number;
  legacyAssigneeIdsConsidered: number;
  candidateRowsReturned: number;
  candidateRowsScoredInJs: number;
  candidateD1StatementCount: number;
  scoringCustomerPagePhysicalLoads: number;
  scoringFallbackCountPhysicalLoads: number;
  scoringFallbackPagePhysicalLoads: number;
  scoringVisibleRowsHydrated: number;
  scoringVisibleRowsScored: number;
  scoringFollowUpPhysicalLoads: number;
  scoringAssigneePhysicalLoads: number;
  scoringHouseholdPhysicalLoads: number;
  scoringFollowUpIdsConsidered: number;
  scoringAssigneeIdsConsidered: number;
  scoringHouseholdIdsConsidered: number;
};

const instrumentation: ScoringSqlInstrumentation = {
  legacyCustomersHydrated: 0,
  legacyCustomersScoredInJs: 0,
  legacyFollowUpIdsConsidered: 0,
  legacyAssigneeIdsConsidered: 0,
  candidateRowsReturned: 0,
  candidateRowsScoredInJs: 0,
  candidateD1StatementCount: 0,
  scoringCustomerPagePhysicalLoads: 0,
  scoringFallbackCountPhysicalLoads: 0,
  scoringFallbackPagePhysicalLoads: 0,
  scoringVisibleRowsHydrated: 0,
  scoringVisibleRowsScored: 0,
  scoringFollowUpPhysicalLoads: 0,
  scoringAssigneePhysicalLoads: 0,
  scoringHouseholdPhysicalLoads: 0,
  scoringFollowUpIdsConsidered: 0,
  scoringAssigneeIdsConsidered: 0,
  scoringHouseholdIdsConsidered: 0,
};

export function resetScoringSqlInstrumentation(): void {
  instrumentation.legacyCustomersHydrated = 0;
  instrumentation.legacyCustomersScoredInJs = 0;
  instrumentation.legacyFollowUpIdsConsidered = 0;
  instrumentation.legacyAssigneeIdsConsidered = 0;
  instrumentation.candidateRowsReturned = 0;
  instrumentation.candidateRowsScoredInJs = 0;
  instrumentation.candidateD1StatementCount = 0;
  instrumentation.scoringCustomerPagePhysicalLoads = 0;
  instrumentation.scoringFallbackCountPhysicalLoads = 0;
  instrumentation.scoringFallbackPagePhysicalLoads = 0;
  instrumentation.scoringVisibleRowsHydrated = 0;
  instrumentation.scoringVisibleRowsScored = 0;
  instrumentation.scoringFollowUpPhysicalLoads = 0;
  instrumentation.scoringAssigneePhysicalLoads = 0;
  instrumentation.scoringHouseholdPhysicalLoads = 0;
  instrumentation.scoringFollowUpIdsConsidered = 0;
  instrumentation.scoringAssigneeIdsConsidered = 0;
  instrumentation.scoringHouseholdIdsConsidered = 0;
}

export function getScoringSqlInstrumentation(): Readonly<ScoringSqlInstrumentation> {
  return instrumentation;
}

export function recordLegacyScoringPath(stats: {
  customersHydrated: number;
  followUpIdsConsidered: number;
  customersScoredInJs: number;
  assigneeIdsConsidered?: number;
}): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND !== "1") {
    return;
  }
  instrumentation.legacyCustomersHydrated += stats.customersHydrated;
  instrumentation.legacyFollowUpIdsConsidered += stats.followUpIdsConsidered;
  instrumentation.legacyAssigneeIdsConsidered +=
    stats.assigneeIdsConsidered ?? stats.customersHydrated;
  instrumentation.legacyCustomersScoredInJs += stats.customersScoredInJs;
}

export function recordCandidateScoringPath(stats: {
  rowsReturned: number;
  rowsScoredInJs: number;
  d1Statements: number;
}): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND !== "1") {
    return;
  }
  instrumentation.candidateRowsReturned += stats.rowsReturned;
  instrumentation.candidateRowsScoredInJs += stats.rowsScoredInJs;
  instrumentation.candidateD1StatementCount += stats.d1Statements;
}

function instrumentationEnabled(): boolean {
  return process.env.CRM_ALLOW_TEST_DB_BIND === "1";
}

export function recordScoringCustomerPageLoad(
  kind: "requested" | "fallback",
): void {
  if (!instrumentationEnabled()) return;
  if (kind === "requested") {
    instrumentation.scoringCustomerPagePhysicalLoads += 1;
  } else {
    instrumentation.scoringFallbackPagePhysicalLoads += 1;
  }
}

export function recordScoringFallbackCountLoad(): void {
  if (!instrumentationEnabled()) return;
  instrumentation.scoringFallbackCountPhysicalLoads += 1;
}

export function recordScoringVisibleRowsHydrated(count: number): void {
  if (!instrumentationEnabled()) return;
  instrumentation.scoringVisibleRowsHydrated += count;
}

export function recordScoringVisibleRowsScored(count: number): void {
  if (!instrumentationEnabled()) return;
  instrumentation.scoringVisibleRowsScored += count;
}

export function recordScoringPageSupportLoads(customerCount: number): void {
  if (!instrumentationEnabled() || customerCount === 0) return;
  instrumentation.scoringFollowUpPhysicalLoads += 1;
  instrumentation.scoringAssigneePhysicalLoads += 1;
  instrumentation.scoringHouseholdPhysicalLoads += 1;
  instrumentation.scoringFollowUpIdsConsidered += customerCount;
  instrumentation.scoringAssigneeIdsConsidered += customerCount;
  instrumentation.scoringHouseholdIdsConsidered += customerCount;
}
