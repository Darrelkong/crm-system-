# Follow-up F1: idempotent create and timeline Next Action

## Current integration status — 2026-09-30

F1 is implemented and accepted as the intentional F4 dependency. Its exact commit is already in F4; no separate F1 merge/cherry-pick was performed.

Included in [Integration 1B](CRM_INTEGRATION_1B.md), candidate only. **NOT
PRODUCTION DEPLOYED. Integration 1C validation is PENDING.** Historical standalone
branch/base statements and test evidence below remain preserved; integration does
not retroactively turn those tests into cross-feature validation.

## Standalone origin and historical evidence

2026-09-27. Local implementation/validation only; NOT Production deployed.
Base: remote main `a481689ad3854b85dfa6073c9aa495453659fb58`.
Branch: `fix/follow-up-idempotency-timeline`, in a separate worktree.
No Smart Ingest 2 code, migration or deployment is included.

## Observed failure and submission lifecycle

Customer-detail “新增客户跟进” and the post-customer-create link open the same
`follow-ups/new` form. It already used `postFollowUpCreateOnce` with a per-mount
`useRef(createFollowUpSubmitFlight())`. Normal rendering does not recreate this
lock. Form submit (including Enter) and duplicate confirmation share that path.
The existing same-mount rapid-click tests passed before this change; that
specific client-only failure was not reproduced. This audit did not inspect
Production or establish the precise cause of the six historical duplicates.

The server did generate a fresh follow-up UUID for every POST. A local D1
reproduction against the original service body sent the same logical identity
and content twice, with duplicate-content confirmation, and received two
201 responses with different follow-up IDs. Client locking alone cannot protect
response-loss retries or requests outside the same mounted form. A navigation
error could also release the old successful client lock.

The existing flight now owns one lazy UUID for the form's logical submission.
It acquires synchronously before awaiting fetch. In-flight fields and controls
are disabled. Network/HTTP failure permits retry with the same identity;
duplicate-content confirmation also retains it. Successful completion remains
locked even if navigation subsequently throws. A new form creates a new identity.
A deliberate form close/reopen starts a new submission, not recovery of the old
one. No artificial delay or content/time-window idempotency is used.

## Server contract and atomic boundary

POST requires UUID-v4 `submissionId`, used as the existing follow-up primary key.
No migration is required. Missing/invalid identities fail validation; clients
with an older cached form must refresh/reopen it rather than silently creating
non-idempotent records.

Authentication remains in the route. Pending-customer and follow-up permissions
are checked in the extracted create service before canonical recovery or writes.
A replay must match customer, actor and normalized saved business fields.
Conflicting reuse returns 409. Canonical recovery precedes time-sensitive input
validation and duplicate-content checks so an unchanged retry can recover an
already committed record. A genuinely new ID still encounters the existing
same-content confirmation rule; explicit confirmation permits a separate record.

One D1 batch contains, in order:

1. Strict follow-up INSERT using that primary key.
2. Customer timestamps and applicable reclamation-cycle reset.
3. Applicable pending reclamation item completion for the captured owner/cycle.
4. Follow-up task conditional insert/update and its business audit.
5. Exactly one `follow_up.created` audit, including canonical task ID receipt.

A concurrent loser fails the first primary-key insert, rolling back its whole
batch. It then reads the committed canonical follow-up and receipt. Task
existence is evaluated inside the batch; no racy task preflight insert is used.
A failure in the last audit also rolls back all preceding business statements.
Post-commit response loss is recovered from the same persisted receipt. Replays
do not repeat task, customer, reclamation completion or business-audit writes.
Audit receipts are retained under the existing audit lifecycle; a missing receipt
fails safely rather than recreating business effects.

Derived reclamation summary/notification reconciliation remains outside the
business batch and only runs on the winning normal completion path. A failure
there is logged safely and does not fail the committed create. The existing
reclamation engine also refreshes those summaries. A lost batch response can
therefore leave derived summaries awaiting the next normal reconciliation;
follow-up/task/reclamation completion and the receipt remain committed together.
This is not a broad reclamation redesign. Normal denied/validation audit logging
and the existing first-contact task-repair gate retain their established behavior.
Zero business mutation assertions concern denied authorization/invalid input,
not a claim that every denied HTTP request writes no audit or repair record.

## Timeline

`buildFollowUpItem` carries the saved row's `nextAction` only for full visibility.
Masked/archived-basic results omit it. `CustomerTimelineView` renders it as a
separate secondary section below the summary using existing localized
`followUps.nextAction`; nothing is concatenated or copied into stored summary.
Null/blank historical actions have no empty heading. Text is React-escaped and
wraps long words/URLs. Desktop and mobile use this same timeline component/data.

## Local validation evidence

- Baseline client helper: 21/21 passed; server replay reproduction failed as
  expected before the idempotency change.
- Final pure/UI regression: 124/124 passed across submit-flight, validation,
  duplicate-content, first-contact UI, filters, timeline constants and real
  component SSR tests, plus navigation/return-state regressions.
- Disposable local D1 suites: 30/30 passed (8 idempotency/timeline integration
  tests; 12 first-contact gate/wiring regressions; 10 timeline actor/query
  equivalence and static checks). Includes synchronized requests,
  committed response loss, last-statement failure rollback, new-ID duplicate
  confirmation, permission/validation rejection, saved/null timeline action,
  and server-side archived-basic masking.
- Browser visual verification: real component SSR + generated production CSS,
  synthetic data only, 390×844 and 1280×900. Action visible, long URL wraps,
  historical null valid; document scroll width equals viewport at both sizes.
  This is local component/layout verification, not Production/authenticated E2E.
- Main TypeScript noEmit, changed-file ESLint, Next.js build, OpenNext build,
  and `git diff --check`: PASS.
- Initial build failed because Turbopack rejects a node_modules symlink outside
  the worktree root. Reusing a local copy of the already installed dependencies
  resolved this without package installation/config changes. An initial new UI
  assertion used the wrong prop name (`timelineData.items`); corrected to the
  actual `timelineItems` wiring before the passing run. The legacy timeline
  performance suite initially failed three DB cases against an uninitialized
  local store, then two against the serial harness because its customer fixture
  was absent. Both existing timeline suites now use the isolated D1 proxy and
  explicitly populate synthetic history in that harness; final runs passed.
  These were fixture prerequisites, not assertion weakening or runtime repairs.

Commands (from the isolated worktree):

```sh
NODE_ENV=test node --import tsx --test \
  src/lib/follow-ups/follow-up-create-submit-flight.test.ts \
  src/lib/follow-ups/validation.test.ts \
  src/lib/follow-ups/duplicate-content.test.ts \
  src/lib/follow-ups/first-contact-gate-ui.test.ts \
  src/lib/follow-ups/list-filters.test.ts \
  src/lib/customers/timeline/constants.test.ts \
  src/components/customers/customer-timeline-next-action.test.ts
NODE_ENV=test node --import tsx --test \
  src/lib/follow-ups/safe-return-to.test.ts \
  src/lib/follow-ups/safe-return-to-wiring.test.ts \
  src/lib/follow-ups/list-return-state.test.ts \
  src/lib/follow-ups/list-return-state-wiring.test.ts \
  src/lib/follow-ups/list-round-a-wiring.test.ts \
  src/lib/follow-ups/list-compact-filters-wiring.test.ts
CRM_ALLOW_MOCK_AI=1 WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false \
  node scripts/test-mail-d1-serial.mjs \
  src/lib/follow-ups/create-idempotency.integration.test.ts \
  src/lib/follow-ups/first-contact-gate.test.ts
CRM_ALLOW_MOCK_AI=1 WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false \
  node scripts/test-mail-d1-serial.mjs \
  src/lib/customers/timeline/timeline-performance.test.ts \
  src/lib/customers/timeline/timeline-actor-names-d1.test.ts
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
# ESLint: explicit changed TS/TSX file list (no unrelated autofix)
NEXT_TELEMETRY_DISABLED=1 WRANGLER_SEND_METRICS=false npm run build
NEXT_PUBLIC_MAIL_READ_SOURCE=production NEXT_TELEMETRY_DISABLED=1 \
  WRANGLER_SEND_METRICS=false ./node_modules/.bin/opennextjs-cloudflare build
git diff --check
```

The serial D1 harness uses localhost, `--local` and disposable temporary
persistence. Its historical name includes “mail”; no Mail test/send was run.
Existing repository migrations prepare local fixtures only. No new migration,
Production query, remote deployment, duplicate cleanup or Cloudflare mutation
was performed. Deployment and any historical cleanup require separate approval.
