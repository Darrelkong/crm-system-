# Human customer rating — F4B foundation / F4C workflow

Owner-approved contract, 2026-09-27. Branch `feat/human-customer-rating` starts
at reviewed F1 `146f50f266adbe028ab029c3f6047f794b94e26d`, whose main ancestor is
`a481689ad3854b85dfa6073c9aa495453659fb58`. No F2/F3/SI2 source is included.
F4B adds schema and domain planning. F4C adds the follow-up rating form, atomic
human-rating persistence and correction API foundation. Sorting, card badges,
timeline rating rendering, AI UX cleanup and Production release remain out of scope.
The current CRM takeover docs were read in the SI2 checkout; they are not copied
into this independent branch. This document is the current F4 contract/status.

## Locked product contract

Canonical constants/types: `src/lib/customers/rating/domain.ts`.

| Value | Human meaning | Rank |
| --- | --- | --- |
| S | Strong intent; actively progressing; near a clear next stage | 0 |
| A | Clear intent; progressing; conditions or timing remain | 1 |
| B | Potential/moderate intent; needs nurturing | 2 |
| D | Low current intent; not currently progressing | 3 |
| NULL | No human rating yet (UNRATED) | 4 |

No C. New customers have no selector and start NULL/revision 0. Never map from
AI intent/score, deterministic heat, sales stage, customerIntent, outcome or
historical follow-ups. Migration does not infer any rating or generate history.

Eight outcomes require an active S/A/B/D choice, with current rating shown only
as a reference and never preselected: contact_made, replied, interested,
considering, not_interested, awaiting_documents, awaiting_quotation,
awaiting_internal_confirmation.

Three preserve outcomes: no_contact, no_reply, lost_contact. Preserve the
committed rating, including NULL, without a history event or revision increment.
A stale selector value cannot convert preservation into a human decision.

Reclaim-valid remains independent and unchanged: not_interested requires rating
but does not reset reclaim; awaiting_* retain their existing valid semantics.
S does not exempt a customer from reclamation or change timing. Existing
eligibility rules remain in force.

`follow_ups.customer_intent` remains unchanged in schema/history and is never a
rating carrier. F4C removes its new-form UI and required validation, accepts
optional legacy client values (trimmed; absent becomes NULL), and preserves old
values and Customer Insight history behavior.

## Schema and history

0091_human_customer_rating.sql adds nullable customers.customer_rating and
nonnegative integer customer_rating_revision with default 0. Drizzle uses the
same canonical enum values. No standalone rating index is added.

customer_rating_history records HUMAN decisions only:

- follow_up_confirmed: including A → A; after value is S/A/B/D.
- manual_correction: NULL or any rating → S/A/B/D, including same value.
- manual_clear: S/A/B/D → NULL.

Every event increments revision by exactly one. No automatic/preserved/AI/system
events. Manual actions require no follow-up and a trimmed reason of at least
five characters. Pure planners return rating/event data only; they do not write,
authorize, update timestamps, reset cycles/grace or create tasks.

History contains id, customer_id, nullable follow_up_id, actor_user_id,
rating_before/after, action, revision_before/after, reason, recorded_at.
The non-null follow_up_id has a partial UNIQUE index; history retrieval uses
(customer_id, recorded_at, id). Rating state follows committed revision/actual
human submission order, never followUpTime. A backdated follow-up submitted
today can establish today's new rating. The caller must supply the committed
snapshot and enforce CAS; these pure functions are not a concurrency gate. F4C
adds the transaction-safe CAS mechanism described below.

Foreign-key lifecycle:

- customer_id ON DELETE CASCADE: existing authorized recycle-bin hard purge
  also removes that customer's history; soft archive retains it.
- follow_up_id ON DELETE SET NULL: deleting an individual follow-up retains the
  human rating event. For this reason a confirmed event with a NULL link remains
  structurally valid. F4C links the real matching customer/
  follow-up at creation; a CHECK cannot distinguish deletion from initial insert.
- actor_user_id NOT NULL / ON DELETE RESTRICT: preserve attributable actor;
  this does not add or authorize a new user-deletion workflow.

History CHECK constraints do not by themselves synchronize customer current
rating/revision. F4C writes them atomically in the F1 batch.
Follow-up permission/lifecycle guards remain mandatory; planners grant no access.
Public Pool rating modification is forbidden for every actor while status is
public_pool. Admin may later read retained ratings. Team Member pre-claim masked
views must not expose rating. Random-claim logic stays unchanged.

## Future workflow and sorting (not implemented in F4B)

Extend F1's stable submission identity and transaction with the rating event and
conditional current-rating update. Same submission replay returns the original
receipt without another event/revision; different simultaneous submissions
require revision conflict handling. Same-rating human confirmation is a new
event. No-contact creates none. Manual correction will be a separate authorized
operation with reason, never a synthetic follow-up, and must not touch
lastFollowUpAt, lastValidFollowUpAt, reclamation cycle/grace or follow-up tasks.

Normal owned customers: rating rank, then pin within that rating, then existing
follow-up/inactivity ordering. Warning customers override normal rating/pin
order: shortest remaining reclaim time, then rating tie-break. Warning membership
must use configured reclaimWarningDaysBefore and canonical eligibility/countdown,
not hardcoded 14 days or the current hidden 16-day near-risk window. Keep the
factual reclaim warning separate from the rating badge. No rating-completeness
dashboard is included.

## Migration namespace and release discipline

0091 is reserved for F4. Before creation, 193 local/remote ref observations
covering 72 distinct commits had no 0091 migration. SI2 owns 0087–0090 at
b66bb9e0ad90c948a773c914ca18811bac1e83e8. The integration test reads exactly those
four SQL files with git show into temporary paths; it neither copies SI2 runtime
code nor changes that branch. A shallow checkout must obtain that Git object
before running this test; it must not substitute different SQL silently.

Required upgrade paths with populated synthetic 0086 state:

- A: 0086 → 0091.
- B: 0086 → 0087 → 0088 → 0089 → 0090 → 0091.
- C: 0086 → 0091 → 0087 → 0088 → 0089 → 0090.

Wrangler determines pending migrations by complete filename and sorts available
pending files. Tracking id is application order, not migration filename number:
in path C tracking id 87 names 0091. Never use MAX(id), MAX(filename), last row
or numeric prefix alone as proof that all earlier files were applied. Compare
FULL expected/applied/pending filename sets and stop on any unexpected member.
Once applied, never renumber 0091. Future integration must preserve all SQL files.
Additive schema must precede deploying code whose Drizzle customer SELECT now
includes these columns. This branch is not deployable against unmigrated 0086.
No migration is authorized remotely by this document.

Read-only runner audit:

- scripts/production-release-guard.mjs and deploy-production.mjs have no full D1
  applied-filename gate. This is missing verification, not a demonstrated
  max-number implementation. A focused release preflight is required before F4
  deployment; do not assume the canonical deployment command verifies the set.
- scripts/local-d1-safe-backup.mjs:53 prints MAX(id) and the latest applied name
  as "migration state". This is a local snapshot summary, not completeness proof.
- Historical scripts/mail-phase2b8/11/13/15/17-local-d1-verify.mjs query tracking
  id 55/56/57/58/59; phase2b11 also checks id > 56. They encode historical
  contiguous-order assumptions and are not suitable future F4/SI2 release gates.
- src/app/api/health/route.ts reads applied filenames and checks core/0041
  tables, but does not validate F4 columns or the complete pending migration set.
  A green health response is not F4/SI2 migration readiness.
- Bounded migration tests deliberately select files up to a fixture boundary;
  that is not a Production readiness assertion.

No release tooling was changed in F4B. Later focused preflight should validate
full filenames before release, including both supported F4/SI2 orders.

## Validation ledger

Validation results are recorded below after execution. All D1 fixtures use
localhost/local mode with isolated temporary persistence, no Production data.
The migration test checks full legacy customer/follow-up/AI snapshots, NULL/0
ratings, empty history, per-migration FK/quick_check, full B/C application schema
equivalence, constraints, uniqueness and deletion lifecycle.

Executed locally on 2026-09-27:

- `node --import tsx --test src/lib/customers/rating/domain.test.ts src/lib/customers/customer-profile.test.ts src/lib/reclamation/cycle.test.ts src/lib/reclamation/days.test.ts src/lib/reclamation/grace-period.test.ts src/lib/reclamation/reclamation.test.ts`: 80 PASS, including 8 new domain tests.
- `WRANGLER_SEND_METRICS=false node scripts/test-mail-d1-serial.mjs src/lib/customers/rating/history-lifecycle.integration.test.ts src/lib/follow-ups/create-idempotency.integration.test.ts`: 11 PASS (3 new lifecycle tests; 8 existing F1 regressions), each suite on fresh isolated local D1.
- `./node_modules/.bin/tsc --noEmit`: PASS. Nine existing Customer test fixture
  constructors were updated only with customerRating NULL/revision 0; no reclaim
  implementation or assertions changed.
- Changed-file ESLint: PASS, zero warnings/errors.
- `npm run build`: PASS (canonical Next.js production build); no deployment.
- `git diff --check`: PASS.

Development test failures were retained in the review record: the first new
migration fixture omitted the legacy required follow_ups.content column;
a subsequent constraint assertion read only Error.message while Wrangler's JSON
SQL error was in stdout. Both were test-harness corrections, not schema or
safety relaxations. The initial TypeScript pass also identified the nine fixture
constructors above and one new test-array annotation, corrected before final gates.

- Targeted existing reclamation static checks (`--test-name-pattern='wiring|isReclamationWarningLogUniqueConflictError'` on auto-reclaim-lifecycle-atomicity.test.ts and warning-delivery-hardening.test.ts): 8 PASS; their unrelated DB suites were not run.
- `node --import tsx --test --test-concurrency=1 src/lib/customers/rating/migration-0091.integration.test.ts`: final 7/7 PASS. A/B/C all passed, final B/C sqlite_master application schema exactly equivalent; full snapshots preserved; all per-step FK checks empty and quick_check=ok. Constraint/uniqueness/deletion cases passed without relaxing assertions.

Final deduplicated executed total: 106 PASS / 0 FAIL (80 unit/domain, 8 targeted
static, 7 migration, 3 history lifecycle, 8 F1 D1 regression). Earlier fixture/
harness failures above are not hidden or counted as passes. No Production or
remote D1 access, migration, deployment, AI call or change to SI2/F2/F3 occurred.
F4B foundation is complete locally; UI, persistence/CAS integration, sorting,
full workflow acceptance and release approval remain later gates.


## F4C workflow and atomic persistence — 2026-09-27

F4C extends F1 without another lock or idempotency table. The single shared new
follow-up form shows current rating as reference; selection starts empty and
clears on outcome changes. Preserve outcomes hide the selector. A stale 409
retains every unsaved follow-up field, refreshes the authorized rating/revision
reference, clears the choice and requires a new human selection. All three CRM
locales include the new messages. Customer creation is unchanged.

Required follow-up requests carry `customerRating` and
`expectedCustomerRatingRevision` (safe nonnegative integer with room for +1).
Canonical recovery checks the original follow-up body and linked history
actor/customer/ratingAfter/revisionBefore BEFORE rejecting a stale revision.
A response-loss retry returns the original event's rating/revision, even after
later human decisions; clients must not interpret an older receipt as the latest
customer snapshot. Altered logical submissions return 409. Preserve outcomes
ignore selector/revision payloads and write no rating event. Their receipt has
ratingEventId NULL and omits a fresh rating snapshot, avoiding a new disclosure
if the customer relationship changes while a preserve request is in flight.

`ratingStatements` is included in ONE D1 batch alongside the F1 strict follow-up
INSERT, operational updates, task effects and final follow_up.created receipt.
The history customer_id scalar subquery requires the expected committed revision
and eligible customer/actor relationship. A mismatch produces NULL and violates
the existing NOT NULL constraint: an actual SQL failure rolls back the entire
batch. Zero-row UPDATE is not used as a rollback signal. History rating_before
is read inside that same transaction, recorded_at is actual submission time,
and revision ordering is independent of backdated followUpTime. No new migration.

POST `/api/customers/[id]/rating` uses authenticated CRM access and the existing
owner/assignee/Admin follow-up permission model. Public Pool (including Admin),
archived and deleted customers cannot be rated. Pending-create restrictions
remain. Correction takes `submissionId`, nullable `rating`, `expectedRevision`,
and trimmed `reason` of at least five characters. History.id is its canonical
idempotency identity; matching actor/customer/rating/reason/revision/action
recovers the original event before stale rejection. NULL→NULL rejects;
same-rating confirmation increments revision. No correction UI is introduced.

Correction batches write ONLY history, customer rating/revision and one audit.
They do not touch updatedAt/updatedBy, follow-up timestamps, reclaim cycle/grace,
reclamation completion, follow-ups or tasks. Rating audit actions are:
`customer.rating.confirmed_follow_up`, `customer.rating.corrected`,
`customer.rating.cleared`. Metadata contains IDs, ratings and revisions only;
no follow-up text or correction reason is copied into audit. Structured history
is authoritative. Commit-time relationship checks prevent a revoked owner or
assignee from writing, and stale responses reauthorize before exposing current
rating/revision. Public Pool masked projections remain unchanged and omit both.

### F4C local validation evidence

- Unit/UI/permissions/reclamation/locale batch: **162 PASS / 0 FAIL**:
  `node --import tsx --test src/lib/customers/rating/domain.test.ts src/lib/customers/rating/workflow-ui.test.tsx src/lib/follow-ups/validation.test.ts src/lib/follow-ups/duplicate-content.test.ts src/lib/follow-ups/follow-up-create-submit-flight.test.ts src/lib/follow-ups/first-contact-gate-ui.test.ts src/lib/permissions/customer-sensitive-fields.test.ts src/lib/permissions/customers-assignees.test.ts src/lib/permissions/public-pool-detail.test.ts src/lib/reclamation/cycle.test.ts src/lib/reclamation/days.test.ts src/lib/reclamation/grace-period.test.ts src/lib/reclamation/reclamation.test.ts src/i18n/locales/catalog-parity.test.ts`.
- Isolated local D1: **27 rating workflow + 8 F1 = 35 PASS / 0 FAIL**:
  `WRANGLER_SEND_METRICS=false node scripts/test-mail-d1-serial.mjs src/lib/customers/rating/workflow.integration.test.ts src/lib/follow-ups/create-idempotency.integration.test.ts`.
  The new workflow suite was rerun after final correction replay ordering and
  mixed follow-up/correction race and unowned-assignee coverage; final 27/27 passed. Runner uses
  localhost, --local and disposable temporary persistence, including local 0091.
- Direct D1 coverage: all eight required outcomes × all four ratings, missing
  rating/revision rejection; three preserve outcomes including NULL; same-rating
  and backdated confirmation; independent not_interested/awaiting_* reclaim
  behavior; two different follow-up IDs, two correction IDs and mixed paths
  racing one revision; same-ID races; response loss/later-revision replay;
  altered body/actor/customer conflicts; history/rating audit/final follow-up
  audit rollback; manual clear; short reason/invalid values; permission and
  commit-time ownership revocation; correction operational-state isolation.
- UI evidence: rendered native selector, empty initial selection, current A only
  as reference, explicit A selection, preserve-state hiding, outcome/stale state
  transitions retaining notes, authenticated route wiring. Desktop/mobile share
  the same fluid component (390/1280 wrapper render contracts); this is local
  render/state verification, not a claim of interactive browser acceptance.
- Initial unit run: four old single-flight form fixtures omitted the newly
  required rating/revision fields and failed validation before POST. Fixtures
  were updated to the approved contract; original lock/retry assertions remain.
- Final TypeScript, changed-file ESLint, canonical Next.js production build and
  git diff --check results are recorded after completion below.

No Production access, remote migration, deployment, AI call, schema change,
F2/F3/SI2 change or main merge. 0091 remains a future authorized release
prerequisite. F4D/F4E sorting, card badges, timeline rating and AI UX work remain
unimplemented. No production-ready/released claim is made by local validation.

Final F4C local gates: TypeScript noEmit PASS; changed-file ESLint PASS (zero
warnings/errors); npm run build PASS (Next.js 16.2.9; existing middleware
convention deprecation warning only); git diff --check PASS. Final deduplicated
executed coverage: **197 PASS / 0 FAIL**, comprising 162 unit/render/static and
35 local D1 tests. No browser interaction is claimed by these render tests.
