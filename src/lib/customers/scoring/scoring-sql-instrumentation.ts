type ScoringSqlInstrumentation = {
  legacyCustomersHydrated: number;
  legacyCustomersScoredInJs: number;
  legacyFollowUpIdsConsidered: number;
  candidateRowsReturned: number;
  candidateRowsScoredInJs: number;
  candidateD1StatementCount: number;
};

const instrumentation: ScoringSqlInstrumentation = {
  legacyCustomersHydrated: 0,
  legacyCustomersScoredInJs: 0,
  legacyFollowUpIdsConsidered: 0,
  candidateRowsReturned: 0,
  candidateRowsScoredInJs: 0,
  candidateD1StatementCount: 0,
};

export function resetScoringSqlInstrumentation(): void {
  instrumentation.legacyCustomersHydrated = 0;
  instrumentation.legacyCustomersScoredInJs = 0;
  instrumentation.legacyFollowUpIdsConsidered = 0;
  instrumentation.candidateRowsReturned = 0;
  instrumentation.candidateRowsScoredInJs = 0;
  instrumentation.candidateD1StatementCount = 0;
}

export function getScoringSqlInstrumentation(): Readonly<ScoringSqlInstrumentation> {
  return instrumentation;
}

export function recordLegacyScoringPath(stats: {
  customersHydrated: number;
  followUpIdsConsidered: number;
  customersScoredInJs: number;
}): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND !== "1") {
    return;
  }
  instrumentation.legacyCustomersHydrated += stats.customersHydrated;
  instrumentation.legacyFollowUpIdsConsidered += stats.followUpIdsConsidered;
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
