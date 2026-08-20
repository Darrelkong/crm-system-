#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export WRANGLER_SEND_METRICS=false
export CRM_ALLOW_TEST_DB_BIND=1

run_test() {
  local label="$1"
  shift
  echo ""
  echo "========== $label =========="
  if node --import tsx --test --test-concurrency=1 "$@"; then
    echo "RESULT: PASS — $label"
    return 0
  else
    echo "RESULT: FAIL — $label"
    return 1
  fi
}

FAIL=0

run_test "migration-0051" src/lib/customer-sources/migration-0051.integration.test.ts || FAIL=1
run_test "quick-entry-phase2-source" src/lib/public-pool/quick-entry-phase2-source.test.ts || FAIL=1
run_test "quick-entry-batch-service" src/lib/public-pool/quick-entry-batch-service.test.ts || FAIL=1
run_test "quick-entry-customer-db" src/lib/public-pool/quick-entry-customer-db.test.ts || FAIL=1
run_test "quick-entry-entry-method" src/lib/public-pool/quick-entry-entry-method.test.ts || FAIL=1
run_test "quick-entry-ui" "src/app/(dashboard)/public-pool/quick-entry-ui.test.ts" || FAIL=1
run_test "quick-entry-submission-hash" src/lib/public-pool/quick-entry-submission-hash.test.ts || FAIL=1
run_test "quick-entry-submission-repository" src/lib/public-pool/quick-entry-submission-repository.test.ts || FAIL=1
run_test "quick-entry-submission-lease" src/lib/public-pool/quick-entry-submission-lease.test.ts || FAIL=1
run_test "quick-entry-batch-classification" src/lib/public-pool/quick-entry-batch-classification.test.ts || FAIL=1
run_test "quick-entry-customer-validation" src/lib/public-pool/quick-entry-customer-validation.test.ts || FAIL=1
run_test "quick-entry-request-schema" src/lib/public-pool/quick-entry-request-schema.test.ts || FAIL=1
run_test "public-pool-display" src/lib/public-pool/display.test.ts || FAIL=1
run_test "public-pool-random-claim" src/lib/public-pool/random-claim.test.ts || FAIL=1
run_test "customer-source-phase1" src/lib/customer-sources/customer-source-phase1.test.ts || FAIL=1
run_test "customer-tags" src/lib/customer-tags/customer-tags.test.ts || FAIL=1
run_test "migration-0050" src/lib/customer-sources/migration-0050.integration.test.ts || FAIL=1

echo ""
echo "========== tsc =========="
if npx tsc --noEmit; then echo "RESULT: PASS — tsc"; else echo "RESULT: FAIL — tsc"; FAIL=1; fi

echo ""
echo "========== build =========="
if npm run build; then echo "RESULT: PASS — build"; else echo "RESULT: FAIL — build"; FAIL=1; fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "ALL VERIFICATION TESTS PASSED"
else
  echo "SOME VERIFICATION TESTS FAILED"
  exit 1
fi
