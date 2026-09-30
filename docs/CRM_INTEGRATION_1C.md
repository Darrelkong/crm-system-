# Integration 1C — local validation closeout

2026-09-30 · `Darrelkong/crm-system-` · `integration/crm-reviewed-features`

**INTEGRATION 1C LOCAL VALIDATION PASS.** The tested final runtime merge is
`0aaf985744df9f6852448cd19615950db9e9ab9d`. The subsequent closeout commit changes
documentation only. This candidate is **NOT merged to main, NOT Production
deployed, and NOT authorized for Production preflight or release**.

## Exact integration and remediation ancestry

Starting integration tip: `95d6c5feb4b9255bd2a82316e35b445749a8a3e5`.
Merged complete hotfix tip: `558a6ce574064464bf33ea4b18800f7de7f79c17`, with
`--no-ff`, subject `merge: integrate knowledge candidate lifecycle fixes`.
There were no merge conflicts. The integration module register survived the
automatic documentation merge; the two dated hotfix records were retained.

The complete tip already contains `91d3d7271f4beea72857e41430ee283b838ce91a`.
It was not applied separately. Both commits are ancestors of the tested merge.
F1 remains included through F4, never applied twice; accepted F2/F3/F4/SI2 tips
and F4G/H/I remain ancestors. Main remains
`a481689ad3854b85dfa6073c9aa495453659fb58`; accepted feature refs were unchanged.

Two inherited SI2 defects were dynamically reproduced and corrected in the
separately accepted hotfix lineage: repeated candidate draft notifications
causing Maximum update depth, and Keep-all confirmation/refresh causing a
render-phase parent update plus a false intermediate count mismatch. The merged
fix retains real draft updates, independent candidate state, stale-response
protection, and genuine mismatch/backend-error visibility. No API, migration,
category, evidence, comparison, conversion, AI model or deadline change was made
in this merge/validation task.

## Earlier Integration 1C evidence carried forward

The owner explicitly preserved these completed results; they were not rerun
merely for repetition in 1C-D:

- Local migration 0086 → 0087 → 0088 → 0089 → 0090 → 0091 and alternate
  0086 → 0091 → 0087 → 0088 → 0089 → 0090; FK/integrity PASS.
- Locale parity, F4H interpolation and F4I field-error resolution PASS.
- F1/F4 transaction/idempotency/Timeline tests: 43 PASS in the retained local D1
  log. F3+F4 composed follow-up, stale proposal protection, safe rejection/manual
  fallback and 390px follow-up smoke PASS.
- SI2 focused local D1: 86 PASS, including lineage, segment evidence,
  comparison freshness and canonical conversion replay.
- Admin Pool and Team Member server privacy PASS; repaired local fixture Pool
  regression log records 7 PASS. Customer privacy overlay smoke PASS.
- crm-ai selected tests 81 PASS; supplemental Worker tests 88 PASS after the
  test-only 1C-A correction; Preview gateway/guards, comparison model/deadline
  contracts and crm-ai typecheck PASS. Approved Preview timeout remains 60000.

Retained local logs include `/tmp/crm-1cr-f1f4.log`, `/tmp/crm-1cr-si2.log`,
`/tmp/crm-1cr-focused.log` and `/tmp/crm-1cr-pool-seeded.log`. Local logs are
ephemeral evidence, not deployment records. Earlier unsuccessful fixture runs
are not counted as passes.

## New merged-tree lifecycle checks

```sh
NODE_ENV=test node --import tsx --test \
  src/lib/knowledge/knowledge-segment-candidate-cards-ui.test.ts \
  src/lib/knowledge/knowledge-smart-ingest-candidate-refresh-lifecycle.test.ts \
  src/lib/knowledge/knowledge-smart-ingest-candidate-lineage.test.ts
PORT=3198 node scripts/test-knowledge-candidate-lifecycle.mjs
CONFIRM_REFRESH_TEST=1 PORT=3198 node scripts/test-knowledge-candidate-lifecycle.mjs
```

- Focused unit tests: **28 PASS**.
- Real mounted draft composition: **23 assertions PASS**, normal + StrictMode.
- Real mounted confirmation/refresh composition: **105 assertions PASS**,
  normal + StrictMode; healthy pending flow, partial failure, stale response,
  genuine zero/nonzero mismatch and backend-error visibility retained.
- No unbounded parent notifications, render-phase warnings or update-depth errors.

## Integrated synthetic browser and isolation evidence

Reused the existing isolated local fixture at `http://127.0.0.1:3199`, using
normal synthetic Admin/Team Member login and normal Knowledge unlock. The
disposable runtime's production source matched the merge tree. Local D1 uses a
dummy identity; no remote/service AI binding or mail transport was enabled.

Team Member created `SYNTHETIC Integration 1CD two-topic lifecycle`, analyzed
two topics, and selected Keep all. Exactly two cards mounted without a false
mismatch or console warning. Local SQLite confirmed **2 candidate rows / 2
distinct segment IDs**, no duplicate. Both business-picker controls opened
independently. Reload/reopen retained the two cards; the existing single-candidate
source also mounted stably. Admin subsequently reopened the same two cards.

The fresh workflow made one analyze POST, three bounded analysis-status GETs,
and one confirmation PATCH per segment. Candidate/comparison reads settled
between explicit mounts; no request storm appeared during the idle observation.
Customer detail made two insight GETs across two visits, zero component-feedback
GETs for the unavailable generation, and **zero unsolicited feedback PUTs**.
Browser warn/error capture and server logs contained no Maximum update depth or
render-phase update warning throughout the closeout.

The actual desktop Knowledge idle overlay covered 1280×720: `blur(28px)`,
translucent background, watermark, pointer interception and unreadable underlying
content. F2 source remains unchanged, including opaque unsupported-browser,
reduced-transparency and forced-colors fallbacks; those prior focused checks are
carried forward, not claimed as newly exercised native-browser modes.

At 390×844 the Knowledge document/body widths were both 390. Candidate controls,
business picker, keyboard focus and lower primary actions remained reachable
above the bottom navigation. No major overflow or clipped action was observed.

Admin Customer/Pool/Knowledge routes and Team Member owned Customer/masked Pool/
Knowledge routes passed the concise closeout. Follow-up rating selection remained
responsive. The unbound local Basic Organize service returned its expected safe
503 without changing the original text; this is not a new real-provider test.
Earlier accepted composed-fixture and F3 provider evidence remain authoritative.
No accepted follow-up transaction scenario was resubmitted.

Full-row local table digests before/after Knowledge create/analyze/Keep-all found
no customer, rating/history, follow-up, task, reclamation or customer-insight
mutation. After customer/form/Pool navigation, Knowledge business-table digests
were unchanged. Service import/write inspection found no cross-domain coupling;
accepted transaction tests supply the write-path evidence without repetition.
Knowledge unlock-session changes are authentication state, not business-domain
mutation. Only the disposable synthetic Knowledge source/analysis/segments/
candidates were intentionally created.

Screenshots and logs: `/tmp/crm-1cd-final-candidates.png`,
`/tmp/crm-1cd-knowledge-privacy.png`, `/tmp/crm-1cd-knowledge-mobile.png`,
`/tmp/crm-1cd-browser.log`, `/tmp/crm-1cd-unit.log`,
`/tmp/crm-1cd-draft.log`, `/tmp/crm-1cd-confirm.log`.

## Static/build closeout

```sh
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
npm run crm-ai:typecheck
./node_modules/.bin/eslint \
  src/components/knowledge/knowledge-segment-candidate-card.tsx \
  src/components/knowledge/knowledge-segment-candidate-cards.tsx \
  src/components/knowledge/knowledge-smart-ingest-analysis-section.tsx \
  src/lib/knowledge/knowledge-segment-candidate-cards-ui.test.ts \
  scripts/fixtures/knowledge-candidate-lifecycle.tsx \
  scripts/fixtures/knowledge-candidate-confirm-refresh.tsx \
  scripts/test-knowledge-candidate-lifecycle.mjs
NEXT_TELEMETRY_DISABLED=1 WRANGLER_SEND_METRICS=false npm run build
git diff --check
```

All PASS; ESLint has no errors/warnings. Default Next/Turbopack initially rejected
the worktree's outside-root dependency symlink. The link was preserved in a
temporary backup and the already-installed dependencies were locally cloned;
the identical `npm run build` then passed. No package installation, config edit or
bundler substitution was needed. The known middleware deprecation warning remains
non-blocking. Canonical prebuild locale generation produced no tracked changes.

No main merge, accepted-feature modification, Production SQL/migration/deploy,
Preview deploy, Cloudflare operation or Mail send occurred. A later main-integration
decision and any release/preflight remain separately authorized work.
