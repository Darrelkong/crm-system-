-- Phase 2B: global unique on customer_contact_identifiers.
-- Per-customer unique from 0041 is retained.
-- Do not rebuild the table; do not mutate rows.
--
-- Official production order (do not reverse):
-- 1. Final focused tests + typecheck
-- 2. Commit 0042
-- 3. Production D1 full backup
-- 4. Pause create/edit/import/QE briefly
-- 5. Live Coverage (must be clean)
-- 6. Live backfill dry-run (0 diff)
-- 7. Live Phone/WeChat/Email conflict scan (all 0)
-- 8. Push 0042 commit
-- 9. Remote apply 0042 once
-- 10. Verify global unique index + Coverage unchanged
-- 11. Deploy App only if conflict-mapping / dual-write production code changed
--     (schema TS + migration-only: evaluate; mapping changes require deploy)
-- 12. Resume staff operations
-- On index-create failure: do NOT delete/merge customers; inspect migration/index
-- state before any retry. Do not roll back Phase 2A dual-write.

CREATE UNIQUE INDEX uq_customer_contact_identifiers_type_value
  ON customer_contact_identifiers (contact_type, normalized_value);
