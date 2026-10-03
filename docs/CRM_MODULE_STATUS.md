Document status:
CURRENT

Repository:
Darrelkong/crm-system-

Historical takeover verification:
feat/knowledge-smart-ingest-2 @ d9e94c37fb1af503a116663b8da667db4d7fa6dd
2026-09-26

Current integration reconciliation:
integration/crm-reviewed-features, 2026-09-30
See the current-status section and CRM_INTEGRATION_1B.md for exact source tips.

Production baseline:
main @ a481689ad3854b85dfa6073c9aa495453659fb58

Important:
Feature implementation status and Production deployment status are separate.

Last Human Product Review:
2026-09-26 — CHAT/HUMAN REVIEW COMPLETED; OPEN DECISIONS REMAIN DOCUMENTED

# ECHFRONT CRM — module status and evidence

## R1 relationship filter hotfix — 2026-10-03

**LOCAL VALIDATION PASS — NOT MERGED TO MAIN / NOT DEPLOYED.**
Branch: `fix/r1-customer-relationship-filter`, based exactly on
`f5ca38e06fe898faed71d22f2431ae40f18515dd`.
The owner-confirmed R1 release at that base is already deployed; the older
Integration 1C deployment statements below are historical evidence. R1 final
acceptance remains blocked by the deployed relationship-filter defect until a
separately authorized release and Production verification of the correction.
This task performed no Production operation, migration or Mail work.

`CustomersPage` omitted `relationship` when calling `parseCustomerListFilter`.
It now forwards the value and keys `CustomersListClient` by the validated
relationship (`owner`, `collaborator`, or `all`). The key resets stored list rows,
pagination and search state when a relationship tab changes. Passing the server
parameter alone does not reset the existing client `useState(initialRows)`.
Admin ignores this staff-only filter; its key remains `all`. API/search/pagination
parameter builders and permission predicates were already correct and unchanged.

Validation (synthetic local data only):

- `node --test scripts/customer-relationship.test.mjs`: **12 PASS**. Executes
  the real server page and API GET with the real Drizzle query/filter predicates
  against isolated in-memory SQLite. Covers all/owner/collaborator, disjoint
  ownership/collaboration, invalid values, page 2, scoped search, Admin normal/
  archived behavior, and exclusion of unrelated/private, archived, Public Pool
  and pending-approval records. One negative control reproduces the original
  page omission without changing application files.
- `node scripts/test-customer-relationship-browser.mjs`, opened through the
  permitted browser at `http://127.0.0.1:3211`: **31 assertions PASS** under React
  StrictMode. Real customer-list component, tab links, search effects and
  pagination handlers; real page props and API results from the local fixture.
  Six expected API requests, no idle request growth, no React warnings/errors.
  `RELATIONSHIP_NEGATIVE_CONTROL=without-key` fails at the first collaborator
  row assertion after an owner-page-2 → collaborator switch, proving the state
  reset is necessary. Normal mode was rerun successfully afterward.
- **66 existing focused tests PASS**: `customer-list-filters`,
  `customer-collaboration-phase3`, `customer-list-sort`, `sales-stage-list-filter`,
  `list-rows`, `permissions/customers-assignees` and
  `permissions/customer-sensitive-fields` (run with `node --import tsx --test`).
- `npx tsc --noEmit`, focused ESLint on the page and four new test/harness files,
  `npm run build`, and `git diff --check`: **PASS**. Build retains the existing
  middleware-convention deprecation warning. Generated locales and lockfile unchanged.

Fixture boundaries: auth/environment/settings/scoring/presentation seams are
local fakes; SQL membership predicates, server page, API read handler and React
list behavior are real. Next Link navigation is a local adapter that preserves
one React root and uses the real page's key/props, not a full Next router or a
Production session. No D1 binding or migration runner is used. The harness does
not certify live authentication, Production rollout or full CRM acceptance.

## Integration 1C current status — 2026-09-30

Current source is `integration/crm-reviewed-features`, validated runtime tree
`0aaf985744df9f6852448cd19615950db9e9ab9d`. Exact reviewed tips and merge history
are recorded in [Integration 1B](CRM_INTEGRATION_1B.md). The SI2 permanent CRM
documentation remains the foundation; dated earlier gate descriptions below are
historical evidence, not the current acceptance queue.

Owner confirmation in Integration 1B: F1 is accepted through F4; F2 is locally
accepted; F3 is real-AI accepted in its approved isolated environment; **F4 LOCAL
ACCEPTANCE COMPLETE / F4F-R PASS**, retaining F4G/H/I; SI2 standalone acceptance
and isolated Preview evidence are retained. These are inherited acceptance
records. **INTEGRATION 1C LOCAL VALIDATION PASS** is recorded in
[the closeout evidence](CRM_INTEGRATION_1C.md), separating newly executed checks
from carried-forward passes. Both inherited SI2 lifecycle fixes are integrated.
All integrated features remain **NOT PRODUCTION DEPLOYED** and main is unchanged.
Integrated migration source contains 0087–0091; the last recorded Production
migration observation remains through 0086 and was not refreshed here.
Documentation is not release authorization. No main merge, deploy, Production
query/migration, Cloudflare change or Mail work is authorized by this record.

Current documentation corrected in 0F-B after Chat/Human review (2026-09-26). Open decisions remain documented. This register deliberately separates source presence, test presence/results, human acceptance, deployment and runtime verification. No row uses "complete" as a substitute for those dimensions.

User-facing **Team Member / 团队成员 / 團隊成員** maps to the internal `staff` role; code identifiers are unchanged. Owner-confirmed product rules/direction are an additional evidence dimension, not proof of implementation, runtime verification or release authorization.

## Current integrated module register

Authority: owner Integration 1B acceptance confirmation and separately authorized
Integration 1C validation, 2026-09-30. Feature ledgers below remain historical;
[Integration 1C](CRM_INTEGRATION_1C.md) records focused cross-feature, migration,
browser and build evidence and distinguishes carried-forward results.

| Integration unit | Accepted source | Current acceptance | Production |
| --- | --- | --- | --- |
| F1 via F4 | 146f50f | Implemented/accepted dependency; not applied separately | NOT DEPLOYED |
| F2 privacy | b525dca | Implemented / accepted locally | NOT DEPLOYED |
| F3 Basic Organize | 820f92c | Implemented / real-AI accepted in approved isolated environment | NOT DEPLOYED |
| F4 human rating | c3e2e35 | **LOCAL ACCEPTANCE COMPLETE / F4F-R PASS**; F4G/H/I retained | NOT DEPLOYED |
| SI2 | b66bb9e | Standalone accepted; isolated Preview evidence retained | NOT DEPLOYED |
| Integration 1B | ef9acf1 | Candidate assembly and narrow structural checks only | NOT DEPLOYED |
| Integration 1C | 0aaf985 | **LOCAL VALIDATION PASS**; both SI2 lifecycle fixes retained | NOT DEPLOYED / release NOT AUTHORIZED |

Migration source is 0087–0091. No Production migration application is claimed.
F4 browser acceptance is complete; earlier F4G/F4I pending statements are
historical checkpoints superseded by the owner's explicit confirmation.

## Evidence legend

- **B** = feature branch HEAD `d9e94c37fb1af503a116663b8da667db4d7fa6dd`.
- **M** = owner-supplied Production main baseline `a481689ad3854b85dfa6073c9aa495453659fb58`; locally verified main ref. Code membership in M is not independently a runtime source-SHA attestation.
- **D** = 0D authentication and 0D-B read-only resource/version verification, plus 0D-C's single approved migration-metadata SELECT, observed 2026-09-26.
- **E** = 0E source/schema/test/document audit. **E did not rerun application tests** or perform Production business-data smoke checks.
- **R** = 1B-A local remediation on the uncommitted worktree based on `86c33c4c5e3a0a8ce91a167ed11407d42d44cd24`, verified 2026-09-26. Targeted local test results below supersede NR only for their stated coverage. R is not Production or full release validation.
- **NR** under latest test result = **NOT RERUN in 0E/0F-A/0F-B; exact latest execution log/results were not imported**. This does not mean failing tests, and it does not assert a pass.
- **LIKELY (M)** under deployment = source is in the supplied main baseline and compatible infrastructure exists; per-module deployed runtime behavior was not independently proved.
- **Historical scope only** under human acceptance = a dated release/completion record exists, not blanket acceptance of all present behavior.
- **UNKNOWN** = evidence is absent or narrower than the claim; do not silently change it to YES.

Tests listed as existing are coverage locations, not a comprehensive count or proof that package scripts select them all. All row evidence is bounded by B/M/D/E as indicated.

## Historical 0F-B module register

| Module | Code Implemented | Tests Exist | Latest Known Test Result | Human Accepted | Production Deployed | Production Verified | Status | Known Gaps | Evidence / SHA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth | YES | YES | NR | Historical scope only | LIKELY (M) | Access-related secret names/main Worker only; no fresh login/device smoke | IMPLEMENTED; runtime checks bounded | Live Access policy/OTP behavior not inspected; Admin exceptions must be preserved | B/M; [auth](../src/lib/auth), [D1 auth tests](../src/lib/auth/session-access-separation.integration.test.ts), D/E |
| Customer | YES; standalone Contacts scope partial | YES | NR | Historical scope + 0F-B collaboration/history rules confirmed | LIKELY (M) | No customer contents queried | IMPLEMENTED; rule verification gaps | Merge disabled; collaboration lifetime/full release-history UX verification pending; follow-up drift below | B/M; [customer services](../src/lib/customers), [schema](../drizzle/schema/customers.ts), 0F-B owner review |
| Follow-up | YES, current 5/10/45 validation | YES | NR | Owner baseline: content minimum 5, next action minimum 5; no confirmed replacement by 10/45 | LIKELY (M); no live behavior check | NO new runtime verification | **PRODUCT / IMPLEMENTATION DRIFT — HUMAN DECISION REQUIRED** | Current summary 5 characters aligns; next action 10 characters and next follow-up 45 minutes are observed code, not newly approved product policy | B/M; [validation](../src/lib/follow-ups/validation.ts), [P1-07](CRM_IMPLEMENTATION_PLAN.md#p1-07--follow-up-product--implementation-drift), 0F-B owner review |
| Public Pool | YES for pause/quota/cooldown and claim primitives; full confirmed policy not proved | YES | NR | 0F-B per-member/default-disabled/privacy/history rules confirmed | Existing paths LIKELY (M); full rule coverage UNKNOWN | No Production claim/policy test performed | IMPLEMENTED PRIMITIVES; **IMPLEMENTATION VERIFICATION REQUIRED** | New-member default-disabled/copy verification pending; 45-day protection is not equivalent; live settings not queried | B/M; [member policy](../src/lib/public-pool/member-policy.ts), [policy route](../src/app/api/admin/users/[id]/public-pool-policy/route.ts), [users schema](../drizzle/schema/users.ts), 0F-B |
| Approvals | YES for active types | YES | NR | Historical scope only | LIKELY (M) | No live approval mutations | IMPLEMENTED; explicit disabled/legacy types | Customer Merge DISABLED; legacy assignee-update request deprecated | B/M; [approvals](../src/lib/approvals), [disabled merge test](../src/lib/approvals/service-merge-disabled.test.ts) |
| Team Member/Admin | YES | YES | NR | Historical scope only | LIKELY (M) | No Team Member record query/change | IMPLEMENTED | Some older administration/collaboration plans remain unapproved or superseded | B/M; [user administration](../src/lib/users-admin), [permissions](../src/lib/permissions/user-management.ts) |
| Dashboard | YES | YES | NR | 7-day default product presentation confirmed in 0F-B; broader scope not fully imported | LIKELY (M) | Main/AI Workers and service binding only | IMPLEMENTED; default product rule recorded | Default runtime behavior/metrics/AI not freshly verified; 7/30/90 ranges retained where implemented | B/M; [reports](../src/lib/reports), [dashboard AI](../src/lib/ai/dashboard-insights), D + 0F-B |
| Reports | YES | YES | NR | Exact current scope UNKNOWN | LIKELY (M) | No report/business data queried | IMPLEMENTED | Future performance/UX work not approved from historical proposals | B/M; [report tests](../src/lib/reports), E |
| Mail Center | PARTIAL | YES, backend and UI coverage | NR | 0F-B product direction confirmed; full implementation acceptance UNKNOWN | Backend/real read path LIKELY (M); future receipts/auto-reply NO | Worker existence/main bindings only; no send/read smoke | **PARTIAL / HYBRID** | Read receipts and LATER auto-reply: confirmed future direction, NOT IMPLEMENTED / NOT RELEASE APPROVED; click tracking NOT APPROVED; hybrid UI and read-audit gaps remain | B/M; [Mail page](../src/app/(dashboard)/mail/page.tsx), [read source](../src/lib/mail/client/mail-read-source.ts), [services](../src/lib/mail), D/E + 0F-B |
| Large Attachments | YES, with operational gaps | YES | NR | Prior phase scope only | LIKELY (M); live main flags ON | Bucket/main binding/gateway version and main runtime/send flags verified | IMPLEMENTED; OPERATIONS PARTIAL | Periodic physical cleanup, object restore, current CORS/lifecycle not proven; ETag is not SHA-256 verification | B/M; [large attachments](../src/lib/mail/large-attachment), [gateway](../workers/echfront-mail-files/index.ts), D/E |
| Knowledge Core | YES | YES | NR | Exact current scope UNKNOWN | LIKELY (M) | Source bucket/main binding; migrations through 0086 | IMPLEMENTED | Full raw-text revision history/restore not established | B/M; [core](../src/lib/knowledge/core-service.ts), [review](../src/lib/knowledge/review-service.ts), D/E |
| Knowledge Vision | YES for supported images | YES | NR | Earlier acceptance context; exact signed scope UNKNOWN | LIKELY (M) | AI Worker/service binding only; no new inference | IMPLEMENTED; format-limited | Scanned PDF OCR unsupported; output requires usability/human review | B/M; [extraction](../src/lib/knowledge/source-extraction.ts), [vision tests](../workers/crm-ai/tests/knowledge-vision.test.ts), D/E |
| Knowledge Organizer | YES; candidate mode adds B-only work | YES | NR | SI2 candidate mode owner-accepted; older scope not fully imported | Source mode LIKELY (M); SI2 candidate mode NO | Existing schema/AI infrastructure only | IMPLEMENTED; split deployment status | Grounding checks are bounded heuristics; pending candidate schema | B/M; [execution](../src/lib/knowledge/knowledge-organization-execution.ts), [candidate service](../src/lib/knowledge/knowledge-segment-candidate-organizer-service.ts) |
| Knowledge Compare | YES; candidate mode adds B-only work | YES | NR | SI2 candidate mode owner-accepted; older scope not fully imported | Source mode LIKELY (M); SI2 candidate mode NO | Existing migration metadata only | IMPLEMENTED; split deployment status | Fingerprint covers title/summary/body, not every classification/reference field | B/M; [comparison](../src/lib/knowledge/comparison-service.ts), [draft fingerprint](../src/lib/knowledge/knowledge-candidate-comparison-draft.ts) |
| Smart Ingest 1 | YES | YES | NR | Prior takeover acceptance context; full artifact not imported | LIKELY (M); schema YES | **0084–0086 APPLIED**; no fresh workflow smoke | IMPLEMENTED; schema verified | Migration evidence alone does not certify all UI behavior | B/M; [0084](../drizzle/migrations/0084_knowledge_smart_ingest_analysis.sql), [0086](../drizzle/migrations/0086_knowledge_segment_confirmed_status.sql), D/E |
| Smart Ingest 2 | **YES; 1B-A + 1B-A3 local checkpoint** | **YES** | 1B-A3: 88/88 isolated D1 + 48/48 pure/static/i18n; earlier R results retained below; full validation NOT RUN | **YES — owner confirmed baseline; 1B-A Chat review passed with clarification/test completion, addressed in 1B-A3** | **NO** | **NO — 0087–0090 PENDING** | **1B-A CLOSED / CHAT REVIEW BEFORE 1B-B / NOT PRODUCTION DEPLOYED** | 1A remains REMEDIATION REQUIRED BEFORE VALIDATION; 1B-B/release gates pending; preview branch guard mismatch unchanged | B/D/E/R; [remediation tests](../src/lib/knowledge/knowledge-candidate-remediation.integration.test.ts), [local evidence](#1b-a-local-remediation-evidence) |
| crm-ai | YES; new category task in B | YES | NR | Task-specific scope only; SI2 owner acceptance | Existing Worker YES; new SI2 task NO | Existing Worker version/binding verified; task behavior not probed | DEPLOYED BASE + UNDEPLOYED EXTENSION | Package test script omits category-suggest test; real-AI acceptance not rerun | B/M; [AI service](../workers/crm-ai/src/service.ts), [AI tests](../workers/crm-ai/tests), D/E |
| Backup/Recovery | PARTIAL | YES, subset/export/helper checks | NR | Full recovery acceptance UNKNOWN | Backup Worker YES; branch export code parity UNKNOWN | Worker version only; **restore NOT proven** | **PARTIAL; RECOVERY UNPROVEN** | JSON covers 26 tables, no Mail/Knowledge/object bytes; no demonstrated full restore | B; [backup list](../src/lib/backup/constants.ts), [export](../src/lib/backup/export-data.ts), [safe local helper](../scripts/local-d1-safe-backup.mjs), D/E |
| Preview | YES, several distinct modes | YES, guard/local tests | NR | Historical limited scope only | NOT Production; current Preview deployment state not refreshed | Isolated D1/R2 identities/config; live route/tunnel not verified | AVAILABLE WITH SCOPE LIMITS | Historical deployed Preview shared live AI; B2R isolated replacement authorized/in progress; browser Access acceptance pending | B/M; [preview guard](../scripts/deploy-knowledge-preview.mjs), [config](../wrangler.knowledge-preview.jsonc), E |
| Deployment | YES, guarded main/gateway path | YES | NR | Existing canonical path; no new release approved | Existing Worker versions YES; SI2 release NO | Version metadata, main bindings, D1 migration boundary | GUARDED; RELEASE APPROVAL REQUIRED | Script does not run full tests/backups/migrations/other Workers; rollback compatibility must be assessed | B/M; [main deploy](../scripts/deploy-production.mjs), [guard tests](../scripts/production-release-guard.test.mjs), D/E |

## Human-confirmed rules versus implementation evidence

| Confirmed product rule (0F-B) | Current source evidence | Verification boundary |
| --- | --- | --- |
| Independently control each Team Member's claiming enable/disable, quota and cooldown; member overrides global defaults where designed | Admin [policy route](../src/app/api/admin/users/[id]/public-pool-policy/route.ts) and [effective policy](../src/lib/public-pool/member-policy.ts) implement pause/unpause and overrides | IMPLEMENTED IN SOURCE; no fresh Production test. |
| New Team Members default to Public Pool claiming DISABLED | User schema defaults `poolClaimPaused` to `0`; separate 45-day first-login protection exists | **HUMAN-CONFIRMED PRODUCT RULE / IMPLEMENTATION VERIFICATION REQUIRED**; protection is not proof of persistent default-disabled policy. |
| Disabled claim UI says 暂无可领取客户资源 or approved localized equivalent | Current policy has blocked-reason keys; complete UI copy alignment not established | **HUMAN-CONFIRMED PRODUCT RULE / IMPLEMENTATION VERIFICATION REQUIRED**. |
| Disabling claims does not remove/reclaim already-owned customers | Policy route updates user policy and does not mutate customers | IMPLEMENTED IN SOURCE for that route; full workflow side-effect verification still required. |
| Default collaboration is long-term; individual lack of follow-ups does not remove a collaborator; only explicitly selected approved temporary-expiry rules can permit automatic removal | [Collaboration detector](../src/lib/reclamation/collaborative.ts) exempts collaborative customers from ordinary reclaim/warnings; reminder/dry-run paths observed | **HUMAN-CONFIRMED PRODUCT RULE / IMPLEMENTATION VERIFICATION REQUIRED** for complete lifecycle and exception handling; old future-removal comments are not approval. |
| Explicit release confirmation, reason/history, previous owner retained in automatic reclaim, Admin can identify original responsible Team Member; no pre-claim privacy leak | [Release service](../src/lib/public-pool/service.ts) and [reclaim engine](../src/lib/reclamation/engine.ts) persist reason/previous-owner audit metadata | Persistence paths IMPLEMENTED IN SOURCE; full confirmation/Admin presentation **IMPLEMENTATION VERIFICATION REQUIRED**. |

**Follow-up discrepancy:** OWNER PRODUCT BASELINE is a 5-character minimum for both content and next action. CURRENT IMPLEMENTATION OBSERVED is summary minimum 5, next action minimum 10 and scheduling at least 45 minutes ahead. **PRODUCT / IMPLEMENTATION DRIFT — HUMAN DECISION REQUIRED**; no code change or silent product-policy replacement occurred.

**Mail confirmed direction:** independent per-Team Member Mail access/workflow; mailbox separate from sender identity, multiple approved identities per mailbox, From selection, arbitrary validated To/Cc/Bcc, Team Member approval, authorized Admin direct-send, rich text, fixed text/image signatures with user-managed layout, and approximately 100 MB large files subject to technical policy. Existing primitives do not prove every intended UI capability. Read receipts and LATER auto-reply are **CONFIRMED FUTURE PRODUCT DIRECTION — NOT IMPLEMENTED / NOT RELEASE APPROVED**. External click tracking remains **NOT APPROVED / HUMAN DECISION REQUIRED**. See [master specification](CRM_MASTER_SPEC.md#j-mail-center); Mail remains **PARTIAL / HYBRID**.

## Historical Smart Ingest 2 acceptance and release ledger

| Dimension | Status and provenance |
| --- | --- |
| Code Implemented | YES at B. |
| Human Accepted | YES, explicitly supplied by the owner in 0F-A. |
| Engineering Closeout | YES, explicitly supplied by the owner in 0F-A. |
| Latest exact test execution | 1B-A3: focused closure results below; earlier R retained historically; no tests ran in 0E/0F-A/0F-B. |
| GitHub feature backup | Exact B pushed/verified in authorized 0B; no push in 0F-A. |
| Production Deployed | **NO**. |
| Migrations 0087–0090 | **PENDING**, 0D-C metadata evidence. |
| Production Release Audit | **1A: REMEDIATION REQUIRED BEFORE VALIDATION**. 1B-A local fixes do not change this to PASSED. |
| Permission to merge/deploy/migrate | **NOT GRANTED by 1B-A**; local remediation/testing only. |

The 14 implementation commits after M cover candidate foundations, category mapping/suggestion/override, persistent cards, independent organization/hydration, incremental materialization, lineage stability, compare/convert, Open Draft and closeout. Their collective acceptance does not imply individually imported test reports or per-step signed acceptance. The subsequent 0F-C documentation commit is the 1B-A starting HEAD. 1B-A corrects conversion concurrency locally with the evidence below; Chat review and full validation remain outstanding. The owner's baseline acceptance is preserved separately.

## 1B-A local remediation evidence

Observed 2026-09-26 on `feat/knowledge-smart-ingest-2`, starting and ending HEAD `86c33c4c5e3a0a8ce91a167ed11407d42d44cd24`. The starting worktree was clean; remediation is an uncommitted diff. No schema/migration change was needed; schema history remains through 0090. No commit, push, merge, Production query/migration/deploy, Cloudflare modification, real AI call or Mail send occurred. The Global Website repository was not accessed. The 0D Production snapshot was not refreshed.

The [50-case remediation suite](../src/lib/knowledge/knowledge-candidate-remediation.integration.test.ts) covers denied/malformed PATCH zero-write behavior; two callers held at a pre-commit synchronization barrier; Article/version/audit/linkage failure injection and post-commit response loss; both conversion-versus-reanalysis orderings; late organizer completion after supersession, confirmation withdrawal, archive or ineligible state; comparison completion and current organization freshness; delayed AI/mapping versus manual classification; inactive mapping/category and high-to-medium/low/error autofill; legacy/candidate scope isolation; and one Source producing three actual Articles with stable Open Draft IDs. HTTP adapter tests inject the authorization result; they are not a full Next.js/session/unlock browser acceptance run.

Atomic conversion uses a D1 batch: a conditional Article `INSERT … SELECT` rechecks current actor/lineage/confirmed segment/source/category/organization/comparison/revision/unlinked state. Version 1, create audit and candidate linkage depend on that request's inserted Article ID in the same transaction. A loser creates nothing and reads canonical linkage; an uncertain post-commit response also recovers through linkage. No historical Articles are deleted. Reanalysis claims its new run and supersedes segments/candidates in one guarded batch; completion and classification writes recheck current state at commit. Automatic classification uses a revision/manual-flag/business guard and live mapping/category eligibility without resetting human override flags.

Final local results (deduplicated latest successful execution per test file):

| Validation | Result | Scope / provenance |
| --- | --- | --- |
| New remediation D1 suite | **50/50 PASS** | `/tmp/crm-1ba-remediation-final.log` |
| Ten existing D1 suites | **61/61 PASS** | `/tmp/crm-1ba-d1.log`, with corrected compare/convert rerun in `/tmp/crm-1ba-compare-convert-rerun.log` |
| 21 pure/static test files | **114/114 PASS** | Original run 113/113 in `/tmp/crm-1ba-unit.log`; organizer draft file expanded from four to five tests and reran 5/5 in `/tmp/crm-1ba-organizer-unit-final.log` |
| App TypeScript | **PASS** | Installed `tsc --noEmit --incremental false --pretty false`; no emitted artifacts |
| Changed TypeScript ESLint / diff whitespace | **PASS** | Installed ESLint, no autofix; `git diff --check` |
| Full browser acceptance / remote Preview / build / real AI / crm-ai suite | **NOT RUN** | Outside 1B-A scope; crm-ai source unchanged |

The first existing compare/convert regression run had one failed fixture: it directly assigned a category without recording manual override, so organization could correctly clear the automatic category. The fixture now uses the real manual-classification service; both tests passed on rerun. An initial test typecheck referenced an unavailable `D1Database` ambient type; the test adapter cast was corrected and final app typecheck passed. No unresolved targeted test failure remains. The counts above are not a single full-suite acceptance run.

Exact targeted test commands, run from this repository with existing dependencies:

```sh
NODE_ENV=test node --import tsx --test --test-concurrency=1 \
  src/lib/knowledge/knowledge-candidate-comparison-draft.test.ts \
  src/lib/knowledge/knowledge-candidate-open-draft-navigation.test.ts \
  src/lib/knowledge/knowledge-candidate-organizer-draft-usability.test.ts \
  src/lib/knowledge/knowledge-comparison-orchestration.test.ts \
  src/lib/knowledge/knowledge-comparison-ui.test.ts \
  src/lib/knowledge/knowledge-ingest-category-ui-state.test.ts \
  src/lib/knowledge/knowledge-ingest-organizer-draft.test.ts \
  src/lib/knowledge/knowledge-segment-candidate-cards-ui.test.ts \
  src/lib/knowledge/knowledge-smart-ingest-candidate-lineage.test.ts \
  src/lib/knowledge/knowledge-smart-ingest-candidate-refresh-lifecycle.test.ts \
  src/lib/knowledge/knowledge-evidence-grounding.test.ts \
  src/lib/knowledge/knowledge-organizer-fact-fidelity.test.ts \
  src/lib/knowledge/knowledge-language-taxonomy-hotfix.test.ts \
  src/lib/knowledge/knowledge-paste-business-identity.test.ts \
  src/lib/knowledge/smart-ingest-segment-scope-safety.test.ts \
  src/lib/knowledge/smart-ingest-authorization.test.ts \
  src/lib/knowledge/ai-organizer.test.ts \
  src/lib/knowledge/ai-comparison-schema.test.ts \
  src/lib/knowledge/article-permissions.test.ts \
  src/lib/knowledge/role-service.test.ts \
  src/lib/knowledge/smart-ingest-analysis-service.test.ts

WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false npm_config_offline=true \
CRM_TEST_TIMEOUT_MS=240000 node scripts/test-mail-d1-serial.mjs \
  src/lib/knowledge/knowledge-candidate-remediation.integration.test.ts \
  src/lib/knowledge/knowledge-segment-candidate-compare-convert.integration.test.ts \
  src/lib/knowledge/knowledge-segment-candidate.integration.test.ts \
  src/lib/knowledge/knowledge-segment-candidate-organizer.integration.test.ts \
  src/lib/knowledge/knowledge-segment-candidate-organizer-hydration.integration.test.ts \
  src/lib/knowledge/knowledge-ingest-category-autofill.integration.test.ts \
  src/lib/knowledge/smart-ingest-analysis.integration.test.ts \
  src/lib/knowledge/smart-ingest-segment-scope-safety.integration.test.ts \
  src/lib/knowledge/comparison-service.integration.test.ts \
  src/lib/knowledge/ingest-service.integration.test.ts \
  src/lib/knowledge/review-publish.integration.test.ts

# Corrected fixture and final added regression cases: same isolated harness.
WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false npm_config_offline=true \
CRM_TEST_TIMEOUT_MS=240000 node scripts/test-mail-d1-serial.mjs \
  src/lib/knowledge/knowledge-segment-candidate-compare-convert.integration.test.ts
WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false npm_config_offline=true \
CRM_TEST_TIMEOUT_MS=240000 node scripts/test-mail-d1-serial.mjs \
  src/lib/knowledge/knowledge-candidate-remediation.integration.test.ts
NODE_ENV=test node --import tsx --test \
  src/lib/knowledge/knowledge-ingest-organizer-draft.test.ts
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
git diff --check
```

The D1 harness was inspected before execution: migrations/seeds run only with `--local` in a fresh temporary persist directory per file; the test gateway uses localhost and the same directory, then is stopped and cleaned up. Mock/injected AI is used. There is no Production or remote Preview test data. These results resolve the named 1B-A blockers locally, not unrelated backlog or release gates. **NEXT: CHAT REVIEW BEFORE 1B-B FULL VALIDATION. Smart Ingest 2 remains NOT PRODUCTION DEPLOYED.**

## 1B-A3 final closure evidence

**2026-09-26 — 1B-A CLOSED; CHAT REVIEW → 1B-B FULL RELEASE VALIDATION.** The owner's remote review passed with one product clarification and small test completion. The complete remediation is frozen in one local checkpoint commit named `fix(knowledge): harden smart ingest release blockers`, directly after base `86c33c4c5e3a0a8ce91a167ed11407d42d44cd24` on `feat/knowledge-smart-ingest-2`. This entry is included in that checkpoint; its SHA is obtained from Git, avoiding a self-referential SHA in its own content. No push/merge or 1B-B execution is authorized by this record.

The confirmed rule is **Manual Category Clear = Human Override**: selection and null both set `manualCategoryOverride=true`, with resolution source `manual`. An explicit `restoreAutomaticClassification: true` Candidate PATCH is the only category reset; it clears the manual flag, advances the revision and resolves the current active mapping in the same guarded update. Without mapping, normal high/medium/low/error AI rules resume. Organizer hydration cannot bypass committed manual state with a false request flag. The editor distinguishes automatic/manual/manual-blank in Simplified Chinese, Traditional Chinese and English, with an explicit restore action; it preserves edited title/summary/body during category refresh. See CRM-D024 and the master specification.

The remediation suite grows from 50 to **63 tests**, adding 13 cases: select/clear, delayed AI, delayed mapping/evidence, fresh hydration/business change preserving blank, explicit reset with mapping, four no-mapping confidence/fallback cases, conflicting reset payload, unauthorized reset, and direct proposed/failed-source PATCH denials. Race/denial tests compare the complete candidate row, including classification/manual/revision fields. This asserts **zero candidate business-data mutation**, not zero authentication/session/audit writes across the entire request.

| Validation in 1B-A3 | Actual result |
| --- | --- |
| Candidate remediation D1 suite | **63/63 PASS**; final rerun after correcting test fixture types |
| Candidate organizer D1 suite | **6/6 PASS** |
| Candidate organizer hydration D1 suite | **3/3 PASS** |
| Category autofill D1 suite | **16/16 PASS** |
| Six pure/static/i18n files below | **48/48 PASS** |
| App `tsc --noEmit --incremental false --pretty false` | **PASS** |
| Changed-file ESLint (26 TypeScript files) / `git diff --check` | **PASS** |

Total for this gate: **136 passing tests (88 D1 + 48 pure/static/i18n)**, deduplicated across reruns. Initial typecheck found two test-fixture types (detail DTO versus persisted row, and null versus optional AI category); both were corrected before final validation/commit. These are scoped local results, not full 1B-B acceptance. Logs: `/tmp/crm-1ba3-d1.log`, `/tmp/crm-1ba3-remediation-final.log`, `/tmp/crm-1ba3-unit.log`, `/tmp/crm-1ba3-tsc-final.log`.

Actual commands (existing installed dependencies; isolated local D1 harness only):

```sh
WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false npm_config_offline=true CRM_TEST_TIMEOUT_MS=240000 node scripts/test-mail-d1-serial.mjs \
  src/lib/knowledge/knowledge-candidate-remediation.integration.test.ts \
  src/lib/knowledge/knowledge-segment-candidate-organizer.integration.test.ts \
  src/lib/knowledge/knowledge-segment-candidate-organizer-hydration.integration.test.ts \
  src/lib/knowledge/knowledge-ingest-category-autofill.integration.test.ts
WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false npm_config_offline=true CRM_TEST_TIMEOUT_MS=240000 node scripts/test-mail-d1-serial.mjs \
  src/lib/knowledge/knowledge-candidate-remediation.integration.test.ts
NODE_ENV=test node --import tsx --test --test-concurrency=1 \
  src/lib/knowledge/knowledge-ingest-organizer-draft.test.ts \
  src/lib/knowledge/knowledge-segment-candidate-cards-ui.test.ts \
  src/lib/knowledge/knowledge-ingest-category-ui-state.test.ts \
  src/lib/knowledge/knowledge-candidate-organizer-draft-usability.test.ts \
  src/lib/knowledge/knowledge-language-taxonomy-hotfix.test.ts \
  src/i18n/locales/catalog-parity.test.ts
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
# Installed ESLint was invoked with the 26 changed .ts/.tsx paths; no --fix.
git diff --check
```

**Retained for 1B-B:** Direct provider-result late comparison-completion race testing (the same commit-time predicate is unchanged); browser/Preview validation including actual reset interactions. No browser/build/remote Preview/real AI/Mail send/Production access or Cloudflare change occurred. No schema/migration change, including no 0091. Main remains at `a481689ad3854b85dfa6073c9aa495453659fb58`; 1A is not relabeled PASS. **Smart Ingest 2 remains NOT PRODUCTION DEPLOYED.** The earlier 1B-A uncommitted-state descriptions and 1B-A2 export are historical evidence, superseded for current category-clear semantics by this closure.

## 1B-B1a error-mapping closure — 2026-09-26

The first 1B-B1 pure/static batch stopped at **425 PASS / 7 FAIL**. The separately authorized narrow correction verified 84 defined Knowledge error codes, 74 previously mapped and 10 missing. All 84 now resolve to canonical non-generic messages in English, Simplified Chinese and Traditional Chinese. Unknown/missing codes use a caller-supplied localized fallback (default generic); raw server error text is never rendered. No API code/status, business logic, schema or migration changed.

The other six failures were classified individually: raw `payload.error` matching `payload.errorCode` was a **TEST REGEX FALSE POSITIVE**; file-picker loading expression, old AI label, extracted organizer mock gate and legacy duplicate marker were **STALE / BRITTLE TESTS**; the removed reanalysis helper assertion was **EXPECTED BEHAVIOR CHANGED BY APPROVED 1B-A REMEDIATION**, which now supersedes segments inside the guarded batch. Corrections check the actual current gate, message branch or mutation scope without altering those runtime paths.

Validation: focused error/static/catalog tests **51 PASS**; the exact original 86-file list **436 PASS / 0 FAIL** (432 original tests plus four focused regressions; focused results are included, not added again). `tsc --noEmit --incremental false --pretty false` passed. Changed-file ESLint passed with zero errors and one pre-existing unused `sheetBlock` warning in `knowledge-ingest-human-review-ux.test.ts`; `git diff --check` passed. Logs: `/tmp/crm-b1a-focused.log`, `/tmp/crm-b1a-static.log`, `/tmp/crm-b1a-typecheck.log`, `/tmp/crm-b1a-eslint.log`. The exact original command is retained in `/tmp/crm-b1-unit-command.json`.

**Only the error-mapping/static-test blocker is closed. 1B-B1 full validation remains incomplete.** No D1 suite, migration, build, remote Preview, real AI or Production operation was performed in this correction. One local commit is authorized, with no push. Next: **CHAT REVIEW → RESUME 1B-B1 FROM THE STOPPED VALIDATION GATE**. Smart Ingest 2 remains **NOT PRODUCTION DEPLOYED**; the dated Production baseline remains 0084–0086 applied / 0087–0090 pending, without new verification.

## 1B-B1c final local validation closure — 2026-09-26

**1B-B1 LOCAL VALIDATION COMPLETE — READY FOR CHAT FINAL B1 REVIEW.** Validation is based on local HEAD `09971eafc4590d45fb20e9df613728451cedf27f`, following approved 1B-A checkpoint `08b8312f44d63054d33df61ceb00604ebd948a33`. The validation additions, narrow MIME type correction and source-type tooling remain **uncommitted** for Chat review. This supersedes the earlier incomplete-local-validation status; it does not grant Preview or Production authorization.

The only runtime-source edit is a type predicate in `workers/crm-ai/src/knowledge-vision.ts`, backed by the same JPEG/PNG acceptance check after lowercase normalization. No MIME behavior, prompt, authorization, binding, schema or migration changes. Tests cover JPEG, PNG, mixed-case normalization, unsupported/non-string values and the returned literal union. Existing `src/env.d.ts` supplies `Ai`; no dependency or binding declaration was added.

The permanent crm-ai release source gate is **all three**: `npm run crm-ai:typecheck` (new `workers/crm-ai/tsconfig.build.json`, extending canonical options and including deployed source plus existing ambient declarations), production-config Wrangler **dry-run**, and relevant behavior/contract tests. Bundling alone is not semantic type validation. The source-only config excludes tests/scripts explicitly; the full development-tree failures are recorded below rather than hidden.

| Local evidence | Result / scope |
| --- | --- |
| Accepted B1a 86-file pure/static batch | **436 PASS / 0 FAIL**, retained without unnecessary repetition |
| Accepted B1R D1 regression | **246 PASS / 0 FAIL**, retained: provider-result completion race, populated 0086→0090 upgrade, concurrency/rollback/recovery, lifecycle/manual matrices, three-candidate/three-Article and legacy isolation |
| Remaining source-restore D1 suite | **14 PASS / 0 FAIL**, fresh isolated local persistence |
| Remaining source-vision-ingest D1 suite | **3 PASS / 0 FAIL**, fresh isolated local persistence; synthetic objects and injected AI |
| Combined relevant D1 evidence | **263 PASS / 0 FAIL** across the retained and two completed suites; the accepted 246 were not rerun |
| Focused category contract / Vision / deadline tests | **29 PASS / 0 FAIL**; final relocated caller/Worker contract rerun **9 PASS / 0 FAIL**, included in 29 |
| Canonical `npm run crm-ai:test` | **60 PASS / 0 FAIL**; overlaps the focused Vision suites and must not be added to 29 as an independent total |
| `npm run crm-ai:typecheck` | **PASS**, zero production-source diagnostics |
| Installed Wrangler production-config dry-run | **PASS**, local bundle only, no upload/deploy |
| Canonical OpenNext production build | **PASS**, including internal `npm run build` / Next.js production build and OpenNext Worker bundle |
| Main-app `tsc --noEmit --incremental false --pretty false` | **PASS**, including the relocated cross-app contract test |
| Changed TypeScript ESLint / `git diff --check` | **PASS**; no locale changes required |

Reproduction commands (all local, installed dependencies only):

```sh
npm run crm-ai:typecheck
WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler deploy --dry-run --config workers/crm-ai/wrangler.jsonc --outdir /tmp/crm-b1c-worker-build
NODE_ENV=test node --import tsx --test --test-concurrency=1 workers/crm-ai/tests/knowledge-category-suggest.test.ts workers/crm-ai/tests/knowledge-vision.test.ts workers/crm-ai/tests/knowledge-vision-deadline.test.ts src/lib/knowledge/knowledge-category-local-contract.test.ts
npm run crm-ai:test
WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false npm_config_offline=true CRM_TEST_TIMEOUT_MS=240000 node scripts/test-mail-d1-serial.mjs src/lib/knowledge/source-restore.integration.test.ts
WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false npm_config_offline=true CRM_TEST_TIMEOUT_MS=240000 node scripts/test-mail-d1-serial.mjs src/lib/knowledge/source-vision-ingest.integration.test.ts
NEXT_PUBLIC_MAIL_READ_SOURCE=production NEXT_TELEMETRY_DISABLED=1 WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false npm_config_offline=true ./node_modules/.bin/opennextjs-cloudflare build
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
./node_modules/.bin/eslint workers/crm-ai/src/knowledge-vision.ts workers/crm-ai/tests/knowledge-vision.test.ts src/lib/knowledge/knowledge-category-local-contract.test.ts src/lib/knowledge/knowledge-candidate-remediation.integration.test.ts
git diff --check
```

The existing cross-app contract test was retained and moved from `workers/crm-ai/tests/knowledge-category-local-contract.test.ts` to `src/lib/knowledge/knowledge-category-local-contract.test.ts`, where application aliases/bindings have their canonical type environment. It imports the actual Worker entry for the injected in-memory service bridge and existing ambient types. Its nine cases retain Worker parsing versus caller UUID/active-category membership responsibilities. An initial triple-slash-reference ESLint failure in that test harness was corrected by this entry import; the final nine-case rerun and ESLint pass. No real AI request occurs.

**P3 CRM-AI TYPECHECK MAINTENANCE DEBT:** `tsc --project workers/crm-ai/tsconfig.json --noEmit --pretty false` still fails with **14 pre-existing diagnostics**: production source **0**, tests **3**, remote/development scripts **11**, tooling/config **0**. All 14 match the pre-fix full-tree diagnostic record. Test errors are union-output property narrowing in `tests/admin-brief.test.ts` (1), `tests/service.test.ts` (1), `tests/staff-actions.test.ts` (1); those runtime tests pass. Script errors are `scripts/admin-brief-remote.ts` (2), `scripts/benchmark-remote.ts` (2), `scripts/staff-actions-remote.ts` (6: union properties/implicit parameters), `scripts/vision-benchmark-b12-remote.ts` (1: `Ai.toMarkdown`). These files are outside the deployed source gate; remote scripts were not executed. Do not report full-tree tsc PASS or silently broaden this release into their repair.

Build generated local ignored `.next` / `.open-next` artifacts; tracked-file hashes were unchanged by the build, including regenerated locale catalogs. Existing middleware/compatibility-date advisories are not build failures. Final boundary review found no change to Knowledge authorization, Customer/Mail/Team Member access, R2 lifecycle, Production config, or AI prompt/classification behavior; no secret value was introduced. No Production, Cloudflare API, remote Preview, real AI, Mail send, deployment, commit, push, schema/migration change or website access occurred.

Logs are local ephemeral evidence: `/tmp/crm-b1c-source-tsc-final.log`, `/tmp/crm-b1c-worker-build.log`, `/tmp/crm-b1c-focused.log`, `/tmp/crm-b1c-contract-final.log`, `/tmp/crm-b1c-crm-ai-tests.log`, `/tmp/crm-b1c-source-restore.log`, `/tmp/crm-b1c-source-vision.log`, `/tmp/crm-b1c-production-build.log`, `/tmp/crm-b1c-app-tsc-final.log`, `/tmp/crm-b1c-eslint-final.log`, `/tmp/crm-b1c-full-worker-tsc.log`.

**NEXT: CHAT FINAL B1 DIFF REVIEW → separately authorized 1B-B2 isolated Preview/browser/real-AI validation → separate Production release gate.** Production flags `CRM_ALLOW_TEST_DB_BIND` and `CRM_ALLOW_MOCK_AI` must both be off at later release preflight. Smart Ingest 2 remains **NOT PRODUCTION DEPLOYED**. Historical Production migrations remain 0084–0086 applied / 0087–0090 pending; this local gate did not reconfirm or change Production.

## Dated Production evidence snapshot

0D verified the intended Cloudflare account, Production `crm-db` identity, deployed Workers, main Worker bindings and listed bucket names. 0D-C executed only `SELECT id, name, applied_at FROM d1_migrations ORDER BY id ASC;` against the verified remote database/config. Result: 86 rows, latest 0086, no later migration, `changes=0`, `changed_db=false`, `rows_written=0`.

The [runbook version table](CRM_DEPLOYMENT_RUNBOOK.md#dated-production-version-snapshot) retains version IDs. Neither gate verified all live routes, DNS/Access policies, all independent Worker binding values, actual sends, R2 objects, restore capability or customer/report content. 0F-A did not refresh these remote observations.

## Test entry-point debt

At B, 0E counted 772 `*.test.*` files; this is inventory, not executed coverage. `npm test` selects explicit unit/DB lists, not every file. `crm-ai:test` lists seven files and omits [knowledge-category-suggest.test.ts](../workers/crm-ai/tests/knowledge-category-suggest.test.ts), the eighth AI test file. Adding a file does not automatically add it to release validation.

The [serial D1 harness](../scripts/test-mail-d1-serial.mjs) creates temporary local state, applies local migrations and seeds fixtures. It is not a read-only operation and must remain local. Separate browser QA scripts exist, but no comprehensive current E2E/CI pass was established. Select touched-domain tests and record the command, SHA, result and environment when authorized; see [P2-03](CRM_IMPLEMENTATION_PLAN.md#p2-03--test-entry-point-coverage).

## Historical document index

Preserve these files. Labels apply to their authority as of 2026-09-26; a useful historical detail may remain correct. The seven current CRM documents are the starting point, and source evidence still outranks prose. "Superseded" does not authorize deletion.

| Document | Label | How to use it |
| --- | --- | --- |
| [README](../README.md) | Partially Current | Setup/orientation; old phase and deployment assumptions require source verification. |
| [SYSTEM_MAP](SYSTEM_MAP.md) | Partially Current | Older inventory; missing current Mail/Knowledge/SI2 breadth. |
| [DEPLOYMENT](DEPLOYMENT.md) | Superseded | Old migration/binding readiness statements; use current CRM runbook. |
| [DEPLOY_RUNBOOK](DEPLOY_RUNBOOK.md) | Partially Current | Separate Worker history useful; current guards/versions and full workflow are in new runbook. |
| [ENV](ENV.md) | Superseded | Attachment/binding descriptions lag current runtime. Never copy secret values into docs. |
| [TESTING](TESTING.md) | Partially Current | Historical test guidance; old counts and claims that tests do not migrate are not current. |
| [BACKUP_RESTORE_RUNBOOK](BACKUP_RESTORE_RUNBOOK.md) | Partially Current | Recovery intent; old table counts/full-restore assumptions need current coverage and rehearsal. |
| [STABLE_RELEASE_CHECKPOINT](STABLE_RELEASE_CHECKPOINT.md) | Superseded | Historical checkpoint, not the latest baseline. |
| [STABLE_RELEASE_2026_06_27](STABLE_RELEASE_2026_06_27.md) | Historical | Dated release evidence. |
| [DEVICE_AUTHORIZATION_RELEASE](DEVICE_AUTHORIZATION_RELEASE_2026_07_03.md) | Historical | Device release scope; later activation changes supersede parts. |
| [LOGIN_SECURITY_RELEASE](LOGIN_SECURITY_RELEASE_297f9b8.md) | Historical | Dated security behavior/tests, not current universal acceptance. |
| [PHASE_1B_DEPLOYMENT_STATUS](PHASE_1B_DEPLOYMENT_STATUS.md) | Historical | Earlier mail/provider state; do not treat old disabled state as live truth. |
| [PHASE_15B_REMOTE_PREP](PHASE_15B_REMOTE_PREP.md) | Historical | Release-preparation record. |
| [PHASE_17_REQUIREMENTS](PHASE_17_REQUIREMENTS.md) | Partially Current | Mix of implemented behavior and unapproved proposals; idle/tasks assumptions are stale. |
| [CRM_ADMIN_COLLAB_PERMISSION_PLAN](CRM_ADMIN_COLLAB_PERMISSION_PLAN.md) | Partially Current | Proposal context; does not approve all deferred work. |
| [CRM_ADMIN_COLLAB_PHASE0_FINDINGS](CRM_ADMIN_COLLAB_PHASE0_FINDINGS.md) | Partially Current | Findings tied to an older source state. |
| [WORKER_1102_INCIDENT](WORKER_1102_INCIDENT_2026-07-24.md) | Historical | Incident analysis; old platform/plan limits are not current provider documentation. |
| [PRE_LAUNCH_PERMISSION_CHECKLIST](PRE_LAUNCH_PERMISSION_CHECKLIST.md) | Partially Current | Checklist fragments, not complete current Mail/Knowledge release coverage. |
| [PRODUCTION_SMOKE_CHECKLIST](PRODUCTION_SMOKE_CHECKLIST.md) | Partially Current | Extend deliberately for a named approved release. |
| [PRODUCTION_MANUAL_SMOKE_2026_07](PRODUCTION_MANUAL_SMOKE_2026_07.md) | Historical | Dated result, not current Production smoke proof. |
| [PUBLIC_POOL_3B_COMPLETION](PUBLIC_POOL_3B_COMPLETION.md) | Historical | Accepted pool/ownership checkpoint and historical backup evidence. |
| [QUICK_ENTRY_V2_UX_SPEC](QUICK_ENTRY_V2_UX_SPEC.md) | Superseded | Original design context; current implementation/completion is later. |
| [QUICK_ENTRY_V2_COMPLETION](QUICK_ENTRY_V2_COMPLETION.md) | Historical | Accepted quick-entry scope. |
| [PHASE5D_COMPLETION](PHASE5D_COMPLETION.md) | Historical | AI phase completion and deferred items; deferral is not approval. |
| [SYSTEM_STATUS_RESUME_COMPLETION](SYSTEM_STATUS_RESUME_COMPLETION.md) | Historical | Mobile/session-resume acceptance for its dated scope. |
| [Mail canonical hash](mail/canonical-content-hash-v1.md) | Partially Current | Hash contract useful; "not implemented" progress notes lag current services. |
| [Large attachment R2 architecture](large-attachment/r2-architecture.md) | Partially Current | Design context; current bucket/checksum/runtime evidence takes precedence. |
| [Presigned PUT checksum](large-attachment/presigned-put-checksum-phase-2b.md) | Partially Current | Compare with implemented signed Content-MD5, not old proposed guarantees. |
| [Large attachment Production phase A](large-attachment/PRODUCTION_RELEASE_PHASE_A.md) | Partially Current | Phase checklist; dated future-deploy wording is not current deployment status. |
| [Mail-files Worker README](../workers/echfront-mail-files/README.md) | Superseded | Earlier missing-deploy-config assumptions conflict with actual config/version. |
| [Legacy README](../legacy/README.md) | Historical | Archive boundary useful; old cleanup suggestions are not current authorization. |

## Documentation review boundary

0F-A created this layer; 0F-B corrects only `AGENTS.md` and the seven current Markdown documents after completed Chat/Human review. Application source, migrations, historical documents and Production remain unchanged. Documentation/path/diff checks are not an application test result. Final Chat/Human documentation review is APPROVED — 2026-09-26; 0F-C is authorized for docs-only commit and feature-branch push. The future **ECHFRONT CRM — Work/Codex Master Handoff V1** Word artifact requires its own post-review authorization; no DOCX is part of this gate.

## 1B-B2R isolated Preview preparation — 2026-09-26

1B-A and 1B-B1 are owner-approved/closed; feature checkpoint `a11822fd60f5ba1123b996e9d58b74542304f329` is backed up. The owner authorized the named new Preview D1/R2/AI resources and replacement of the existing CRM Preview bindings, plus the Preview-only commit/push. The approved repository configuration now targets `crm-db-si2-preview` (`66f0e690-25d1-45d2-aa16-197c5e7f0802`), `crm-knowledge-si2-preview` and `crm-ai-si2-preview`; exact pushed deployment SHA is required by the guard. AI direct mode is opt-in and preserves default Production gateway behavior. Local guard tests (5), existing crm-ai tests (60) and focused gateway/category tests (14) passed; source typecheck and Preview AI dry-run passed.

This entry records configuration/preparation, **not completed remote acceptance**. Deployment versions, migration completion and synthetic real-AI/service results must be verified in the B2R execution report. All browser interactions remain **DEFERRED — HUMAN ACCESS REQUIRED**; Access is unchanged. Old Preview resources are preserved. Smart Ingest 2 remains **NOT PRODUCTION DEPLOYED**; historical Production migration state 0084–0086 applied / 0087–0090 pending is not rechecked or changed here. B2 is not fully PASS until browser acceptance completes.

## 1B-B2C comparison contract correction — 2026-09-27

B2R infrastructure is isolated and migrated through 0090 on the new synthetic Preview D1. Its real category suggestion and organization succeeded, but two comparison runs persisted `AI_COMPARISON_OUTPUT_INVALID`; no acceptance Articles were created. Browser acceptance remains **DEFERRED — HUMAN ACCESS REQUIRED**. This is the starting evidence for B2C, not a new Production observation.

B2C confirms that the Workers AI response schema described all five nested arrays as generic objects, omitting their required fields, confidence bounds and array limits. A small dependency-free wire-schema module now defines those constraints for both app and Worker exports. Worker validation retains its text/content limits and now rejects missing/wrong nullable fields and unexpected properties, consistent with strict app Zod validation. App Zod also enforces the existing `update_existing`/non-null-match invariant already enforced by Worker/service. No fact-classification semantics, prompt, model, retry limit, token limit (3072), authorization, migration or binding changes. Safe invalid-output diagnostics contain task, reason, attempt, response type and array counts only; never source text or raw AI output.

The historical failures did not retain raw output/token-finish metadata, so truncation is **NOT EVIDENCED**. Nested schema drift is confirmed; exact historical malformed fields cannot be reconstructed. Local focused contract tests and targeted disposable-local D1 regression precede a single feature commit and isolated Preview redeployment. Remote retest outcomes must be recorded separately; this entry does not claim B2 PASS. Smart Ingest 2 remains **NOT PRODUCTION DEPLOYED**.

B2C local evidence: 73 focused pure/contract tests PASS; comparison-service D1 10 PASS, candidate compare/convert D1 2 PASS, selected remediation D1 28 PASS (40 total, disposable local persistence only). Main app and crm-ai source TypeScript, Preview AI dry-run and diff check PASS. Changed-file ESLint: 0 errors, 4 pre-existing service warnings. No remote migration was run.

## 1B-B2D comparison model compatibility — 2026-09-27

Starting checkpoint `d2299b8c721aab8458800564712f5e45ac2cc026` passed local contract validation but the isolated real comparison still failed. One bounded Qwen diagnostic service request (normal single internal retry) confirmed a parseable `response` object containing only `matchedCandidateKey` and `relationship`; all five required arrays were absent. `choices[0].message` also existed, but no prompt, response values or reasoning were recorded. This does not establish an envelope-only failure or token truncation; Qwen was not retried again.

`CRM_AI_KNOWLEDGE_COMPARE_MODEL` is now comparison-specific and allowlisted: unset/unsupported values preserve `@cf/qwen/qwen3-30b-a3b-fp8`; only the isolated `crm-ai-si2-preview` configuration opts into `@cf/zai-org/glm-4.7-flash`. Organization, category suggestion, QA and Vision models are unchanged. GLM uses its documented named JSON-schema wrapper, `choices[0].message.content` extraction and `chat_template_kwargs.enable_thinking=false`; it receives the identical canonical prompt/schema and unchanged 3072-token budget. Worker/app strict validation and bounded retry remain unchanged. No arbitrary-key unwrapping or reasoning parsing is allowed. Model API reference: https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/ .

Local focused contract/model/gateway/Vision tests and semantic checks precede the final Preview-only AI deployment. Remote acceptance results are reported separately after deployment; this entry does not claim remote PASS. No infrastructure recreation, remote migration, Production config/model/deployment or Access change is authorized by this entry. Browser acceptance remains **DEFERRED — HUMAN ACCESS REQUIRED**. Smart Ingest 2 remains **NOT PRODUCTION DEPLOYED**.

## 1B-B2E supported JSON Mode model validation — 2026-09-27

At `573815887d9d5e34a52f6494873320a5f1213625`, GLM's documented envelope parsed correctly but both bounded attempts yielded only `relationship`; non-browser B2 remained BLOCKED. The owner authorized one comparison service request per existing synthetic Candidate using `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`, which appears in Cloudflare's official JSON Mode supported-model list (https://developers.cloudflare.com/workers-ai/features/json-mode/).

The comparison-only allowlist now includes that exact model and only `crm-ai-si2-preview` opts in. Unset/unsupported overrides retain Qwen; other Knowledge task models are unchanged. The canonical wire schema (including top-level `anyOf`), prompt, runtime/Zod validators, required fields, nested limits, retry policy and 3072-token budget remain unchanged. The official documentation reviewed did not establish that DeepSeek rejects the conditional keyword, so this gate isolates the model change instead of making an unproven schema change. Local focused tests/type/lint/dry-run checks precede deployment; actual remote results must be reported separately. No new migrations/resources, Production changes or Access changes. Browser acceptance remains **DEFERRED — HUMAN ACCESS REQUIRED**; Smart Ingest 2 remains **NOT PRODUCTION DEPLOYED**.

## 1B-B2G comparison timeout-source diagnostics — 2026-09-27

B2E's DeepSeek service request returned `timeout`; historical diagnostics did not distinguish the application response deadline from provider abort/code/message timeouts. B2F stopped without changes because historical telemetry access returned 403. B2G adds comparison-only internal failure metadata: task/model/attempt, elapsed/configured deadline, classified source, numeric provider code when present, a bounded error-class label and whether an inference result reached the caller. It does not log exception messages, prompts, response values or reasoning. Public error mapping and normal retry behavior are unchanged; no other task receives this diagnostic logging.

Local focused tests cover application deadline, AbortError, 3007/3008, timeout messages, unchanged public/non-timeout errors, late provider settlement and safe logging. A single isolated Preview diagnostic comparison is authorized. Only new evidence of `APPLICATION_RESPONSE_DEADLINE` permits a separate comparison-specific 60-second Preview setting/retest. This entry records implementation, not the yet-unobserved remote outcome. Model, canonical schema, token budget and Production configuration remain unchanged. Smart Ingest 2 remains **NOT PRODUCTION DEPLOYED**; browser acceptance remains **DEFERRED — HUMAN ACCESS REQUIRED**.

## 1B-B2H comparison deadline and model provenance — 2026-09-27

B2G remote evidence: Candidate 1 completed strict DeepSeek comparison in 12,426 ms and converted to one canonical draft. Candidate 2 returned `timeout`; safe live diagnostics identified `APPLICATION_RESPONSE_DEADLINE`, elapsed/configured 20,000 ms, attempt 1, no provider result obtained. Production was unchanged. This satisfies the owner's condition for a comparison-only 60-second Preview retest; Candidate 2 is now the explicitly approved target. Candidate 1 must not be re-compared or its historical model field rewritten.

B2H introduces `CRM_AI_KNOWLEDGE_COMPARE_TIMEOUT_MS`: default/unset 20,000 ms, invalid/non-positive values fall back to that default, positive finite values round and clamp to 1,000–60,000 ms. Only `knowledge_compare` reads it; shared Knowledge, Vision and Customer AI configuration/paths are unchanged. Only `crm-ai-si2-preview` sets 60,000 ms, retaining DeepSeek and direct Workers AI. Schema, token budget and Production config remain unchanged.

Comparison provider now returns data with the actual service-reported model; completed comparison runs persist it instead of a fixed Qwen constant. Injected/mock semantics are retained; historical runs are not rewritten. Local and remote gate outcomes are recorded separately: configuration/code alone does not establish deployment or full B2 acceptance. Browser acceptance remains **DEFERRED — HUMAN ACCESS REQUIRED**; Smart Ingest 2 remains **NOT PRODUCTION DEPLOYED**.

B2H local validation before Preview deployment: 106 focused Worker/app comparison, schema, adapter and deadline checks PASS; comparison-service D1 suite 12 PASS plus Candidate compare/convert 2 PASS against disposable localhost persistence. The first new metadata fixtures failed because the local test-bind flag still selected mock AI and two synthetic paste bodies were identical; fixture-only corrections exercised the actual adapter path and unique sources, then all 12 service tests passed. Worker production-source TypeScript, main TypeScript, Preview AI dry-run and diff check passed; changed-file lint had no errors (five pre-existing warnings). These results do not claim the pending remote retest or human browser acceptance.


## Integration 1C-B — SI2 candidate draft lifecycle hotfix — 2026-09-30

**Inherited SI2 runtime defect dynamically confirmed.** This isolated hotfix starts exactly at accepted SI2 `b66bb9e0ad90c948a773c914ca18811bac1e83e8` on `fix/knowledge-candidate-draft-lifecycle`. It contains no F1/F2/F3/F4 integration code. The accepted SI2 branch, main, and integration candidate `95d6c5feb4b9255bd2a82316e35b445749a8a3e5` remain unchanged. This record does not complete Integration 1C or authorize a merge/deployment.

Before editing, a local archive of that exact SI2 commit reproduced `Maximum update depth exceeded` when the synthetic contributor's retained, confirmed topic mounted its persistent candidate. The browser stack was candidate-card effect → cards callback → analysis-section `setCandidateDrafts` (baseline lines 214, 135, 736). Only the previously established local dummy-D1 config and a disposable SQLite fixture copy were used; no AI/service/R2 binding or mail transport was enabled. Authentication and Knowledge unlock were normal existing synthetic sessions.

The parent supplied a new callback each render; the list added another inline callback; the child effect depended on that identity and notified on every rerender. The parent always produced a new state object for an unchanged draft. The negative-control mounted regression using the original three SI2 modules also failed without StrictMode, so StrictMode is not the cause.

The narrow fix passes a stable callback through the list, identifies the candidate in the child's notification, and retains the parent's existing state identity when title, summary, body, organized status and organization run ID are equal. Genuine edits still propagate once and remain candidate-scoped. No timers, error suppression, StrictMode disabling, API/schema/migration, category, organizer, evidence, comparison, conversion or AI configuration change is included.

Validation commands (existing installed tools, local only):

```sh
PORT=3198 node scripts/test-knowledge-candidate-lifecycle.mjs
# Open the printed loopback URL; the real React composition posts its results.
NODE_ENV=test node --import tsx --test \
  src/lib/knowledge/knowledge-segment-candidate-cards-ui.test.ts \
  src/lib/knowledge/knowledge-smart-ingest-candidate-refresh-lifecycle.test.ts \
  src/lib/knowledge/knowledge-smart-ingest-candidate-lineage.test.ts \
  src/lib/knowledge/knowledge-ingest-organizer-draft.test.ts \
  src/lib/knowledge/knowledge-candidate-organizer-draft-usability.test.ts
WRANGLER_SEND_METRICS=false CRM_ALLOW_MOCK_AI=1 node scripts/test-mail-d1-serial.mjs \
  src/lib/knowledge/knowledge-segment-candidate.integration.test.ts \
  src/lib/knowledge/knowledge-segment-candidate-organizer-hydration.integration.test.ts \
  src/lib/knowledge/knowledge-segment-candidate-compare-convert.integration.test.ts \
  src/lib/knowledge/knowledge-candidate-remediation.integration.test.ts
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
./node_modules/.bin/eslint src/components/knowledge/knowledge-segment-candidate-card.tsx \
  src/components/knowledge/knowledge-segment-candidate-cards.tsx \
  src/components/knowledge/knowledge-smart-ingest-analysis-section.tsx \
  scripts/fixtures/knowledge-candidate-lifecycle.tsx scripts/test-knowledge-candidate-lifecycle.mjs
git diff --check
```

- Mounted composition: **23 assertions PASS**, including normal + StrictMode, initial parent snapshots, identical rerender, organizer result, real controlled text edit, independent A/B state, stable idle network, and no React errors. Observation-only build instrumentation counts the actual production component's notifications/state identities; no fake lifecycle callback replaces them. Normal: 10 parent renders/5 state identities/5 notifications; StrictMode: 20/5/7. Counts are evidence, not exact-render-count assertions.
- Existing card/refresh/lineage/draft tests: **36 PASS**.
- Local D1 suites: **80 PASS** (8 materialization + 3 hydration + 2 compare/convert + 67 remediation). Includes manual override/restore, segment evidence, lifecycle guards, comparison freshness and conversion canonical replay.
- Main TypeScript, focused ESLint and whitespace checks: **PASS**.
- Test logs: `/tmp/crm-1cb-focused.log`, `/tmp/crm-1cb-d1.log`, `/tmp/crm-1cb-lifecycle-final.log`, `/tmp/crm-1cb-tsc.log`, `/tmp/crm-1cb-eslint.log`. Baseline screenshot: `/tmp/crm-1cb-baseline.png`.

**NOT Production deployed. No remote AI call, Cloudflare mutation, Mail send or integration merge.** Later integration and unfinished Integration 1C validation require separate authorization.

Browser closeout: the original retained candidate and a newly analyzed/kept two-topic synthetic source mounted without `Maximum update depth exceeded` after the patch. Reloading and reopening the two-topic source preserved both cards, category controls and pending organizer state; opening/closing a business selector remained interactive. The reload/reopen produced two candidate-list GETs and three comparison GETs per candidate during development setup, then no further candidate requests during several minutes of observation (ordinary auth/health polling remained). No draft notification/request storm returned. Screenshot: `/tmp/crm-1cb-fixed.png`.

Separate observation, **not repaired or dynamically attributed by this hotfix**: the fresh two-topic “Keep all” action emitted one `Cannot update KnowledgeIngestClient while rendering KnowledgeSmartIngestAnalysisSection` warning and transiently showed “Topic count does not match your review.” Both cards were persisted, and the banner disappeared on reload. The existing confirmation updater calls `onScopeChange` within `setRun`; those confirmation/refresh bodies are unchanged here. This needs a separately reviewed, narrow confirmation/refresh investigation before treating the entire Knowledge journey as console-clean. It does not reproduce the repaired draft-notification loop. This hotfix's browser result is limited to stable candidate mount, interaction and reload; it is not a full Knowledge or Integration 1C PASS.

## Integration 1C-C — confirmation/refresh lifecycle — 2026-09-30

**Inherited SI2 confirmation lifecycle defect confirmed and narrowly repaired** on `fix/knowledge-candidate-confirm-refresh-lifecycle`, starting exactly from accepted first hotfix `91d3d7271f4beea72857e41430ee283b838ce91a`. This supersedes the unresolved Keep-all observation in 1C-B above; it does not complete Integration 1C, merge a branch, or authorize deployment.

Before source changes, the same isolated localhost runtime (dummy local D1, no remote service/AI/R2 binding, Mail transport disabled) used normal synthetic Team Member login and Knowledge unlock. A fresh two-topic text source → Analyze → Keep all reproduced:

> Cannot update a component (`KnowledgeIngestClient`) while rendering a different component (`KnowledgeSmartIngestAnalysisSection`). To locate the bad setState() call inside `KnowledgeSmartIngestAnalysisSection`, follow the stack trace as described in https://react.dev/link/setstate-in-render

Stack: `knowledge-smart-ingest-analysis-section.tsx:455` (`onScopeChange` inside the `setRun` updater) → section render at line 106 → `knowledge-ingest-client.tsx:1537` → ingest page line 37. No further user action was required. Expected count 2; initially 0 rendered candidates, then 2 with a false count-mismatch banner; SQLite had 2 rows/2 distinct segment IDs. Reload/reopen retained 2 and cleared the banner. Evidence: `/tmp/crm-1cc-baseline.png`, `/tmp/crm-1cc-baseline-dom.txt`.

The original SI2 `b66bb9e0ad90c948a773c914ca18811bac1e83e8` three component files also reproduce the parent-update warning and intermediate refresh in the mounted real-component negative control, without StrictMode. The first-hotfix source reproduces identically. This is **inherited SI2**, not a first-hotfix regression or fixture-only artifact.

Root cause: both single-confirm and Keep-all functional `setRun` updaters contained parent notification side effects; React can evaluate these during render. Keep-all also triggered refreshes for intermediate committed counts through its effect and an explicit final speculative count, while refresh results had no generation guard. A response checked against an older expected count could set mismatch; a later matching response did not explicitly clear it.

Narrow remediation:

- State updaters only calculate state. Existing post-commit scope effect notifies the parent.
- Candidate reconciliation waits until the confirmation action settles, using the actual committed count (including partial failure). No speculative pre-confirmed-plus-requested count.
- A refresh sequence invalidates obsolete results across confirmation, source/run changes and unmount. Latest successful results explicitly set/clear mismatch from their final count.
- Pending materialization is not reported as final mismatch. The existing error UI is retained alongside already-loaded cards, and a genuine zero-result mismatch is not hidden by the empty-list return. Genuine unresolved mismatch and failed confirmation/materialization remain visible. No timer workaround, warning suppression, full-page reload requirement, backend/API/schema/AI or business-rule change.

Validation (local only):

```sh
CONFIRM_REFRESH_TEST=1 PORT=3198 node scripts/test-knowledge-candidate-lifecycle.mjs
PORT=3198 node scripts/test-knowledge-candidate-lifecycle.mjs
# Each runner is opened in the local browser and exits on its posted test result.
NODE_ENV=test node --import tsx --test \
  src/lib/knowledge/knowledge-segment-candidate-cards-ui.test.ts \
  src/lib/knowledge/knowledge-smart-ingest-candidate-refresh-lifecycle.test.ts \
  src/lib/knowledge/knowledge-smart-ingest-candidate-lineage.test.ts \
  src/lib/knowledge/knowledge-ingest-organizer-draft.test.ts \
  src/lib/knowledge/knowledge-candidate-organizer-draft-usability.test.ts
WRANGLER_SEND_METRICS=false CRM_ALLOW_MOCK_AI=1 node scripts/test-mail-d1-serial.mjs \
  src/lib/knowledge/knowledge-segment-candidate.integration.test.ts \
  src/lib/knowledge/knowledge-segment-candidate-organizer-hydration.integration.test.ts \
  src/lib/knowledge/knowledge-segment-candidate-compare-convert.integration.test.ts \
  src/lib/knowledge/knowledge-candidate-remediation.integration.test.ts
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
./node_modules/.bin/eslint src/components/knowledge/knowledge-smart-ingest-analysis-section.tsx \
  src/components/knowledge/knowledge-segment-candidate-cards.tsx \
  scripts/fixtures/knowledge-candidate-confirm-refresh.tsx scripts/test-knowledge-candidate-lifecycle.mjs \
  src/lib/knowledge/knowledge-segment-candidate-cards-ui.test.ts
git diff --check
```

- New mounted real composition: **105 assertions PASS**, normal and StrictMode. Covers Analyze, Keep-all, delayed second confirmation, delayed materialization, genuine nonzero/zero-count mismatch, backend failure, refresh failure with an existing card, partial confirmation, reload, bounded idle, and late obsolete refresh after individual confirmation. Parent is a real state owner; production callbacks/updaters/effects are not mocked away.
- First draft-lifecycle regression: **23 assertions PASS**.
- Nearby card/refresh/lineage/draft unit tests: **36 PASS**. Two source-shape assertions were updated for the settled-action effect dependency and zero-count guard location; their original behavior remains covered by mounted tests.
- Disposable D1: **80 PASS** (8 materialization, 3 organizer hydration, 2 compare/convert, 67 remediation). Candidate uniqueness, evidence, manual override/restore, lineage, comparison freshness and canonical conversion remain covered.
- TypeScript, focused ESLint and diff check: **PASS**.
- Post-fix fresh browser Analyze/Keep-all: 2 kept → 2 candidates, no false banner, no render-phase/update-depth warning. Both business selectors usable independently. Reload/reopen stable; local SQLite confirms 2 rows/2 distinct segments. One PATCH per topic and one final candidates GET in the fresh confirmation flow; no repeated candidate requests after settling. Development comparison hydration was bounded (two GETs per candidate on initial mount). No real provider invocation. Screenshot: `/tmp/crm-1cc-fixed.png`.
- Evidence logs: `/tmp/crm-1cc-regression-final.log`, `/tmp/crm-1cc-first-regression.log`, `/tmp/crm-1cc-negative.log`, `/tmp/crm-1cc-original-si2-negative.log`, `/tmp/crm-1cc-focused.log`, `/tmp/crm-1cc-d1.log`, `/tmp/crm-1cc-tsc-final.log`, `/tmp/crm-1cc-eslint-final.log`, `/tmp/crm-1cc-browser.log`.

Accepted SI2, first-hotfix, integration and main refs remain unchanged. Synthetic local source/segment/candidate data was created for reproduction. **NOT Production deployed; no Cloudflare modification or Mail send.** Separately authorized integration and the unfinished Integration 1C gate remain required.

## Mail M1C local layout evidence — 2026-10-01

**M1C LOCAL SCROLL/LAYOUT FIX VALIDATED** on `fix/mail-reader-scroll-geometry`, based on M1B `8a316af37cd8740781d1362b4098d49cf9dfa111`. Real local reader geometry: 158 assertions pass across six synthetic fixtures at desktop/390px; canonical local build and TypeScript pass. One unchanged attachment-action source-regex test debt remains. See [M1C evidence and limitations](mail/MAIL_M1C_READER_SCROLL_FIX.md). **HTML FIDELITY / IMAGE SUPPORT STILL PENDING; NOT MERGED TO MAIN; NOT DEPLOYED.** Mail remains PARTIAL / HYBRID; no transport, sanitizer, image policy or permission change.


## Mail M1D local fidelity evidence — 2026-10-01

**M1D SAFE HTML FIDELITY LOCALLY VALIDATED** on `fix/mail-safe-html-fidelity`, based on M1C `4933c5c6d11facbb6424fe052c9835e2f47de5ab`. Expanded versioned inbound inline-layout allowlist and script-disabled document isolation; 288 browser assertions pass across 18 desktop/mobile cases. M1C scroll regression preserved; TypeScript, focused ESLint and local build pass. Named inherited attachment-action source-regex test debt remains. [Evidence and limitations](mail/MAIL_M1D_SAFE_HTML_FIDELITY.md). **REMOTE/CID IMAGE SUPPORT PENDING M1E; NOT MERGED TO MAIN; NOT DEPLOYED.** No outbound-policy, permission, schema or transport change.

Mail M1E (2026-10-01): **REMOTE IMAGE / IMAGE-ONLY LOCALLY VALIDATED** on the M1D descendant;300 image/privacy browser assertions and180 preserved scroll/fidelity assertions pass. CID durable mapping requires separate schema review. Focused units105 pass/1 unchanged named attachment-action regex debt; TypeScript, lint and local build pass. [Exact evidence/limits](mail/MAIL_M1E_IMAGE_PRIVACY_AND_CID.md). **NOT merged to main / NOT deployed; M1F/M2 not started.**

Mail M1E-C (2026-10-02): **CID INLINE IMAGES LOCALLY VALIDATED** on `fix/mail-cid-inline-images`, based exactly on M1E `2fc40c437688a5d09fcd3b9d3b026928b2b1875c`. Migration0092 is additive and local-only; canonical0086→0092 and0091→0092, FK/quick/integrity checks pass. CID194, remote privacy300 and preserved scroll/fidelity180 browser assertions pass; focused units134 pass/1 unchanged attachment-action regex debt, D1/service19/19 and migration2/2. TypeScript, focused lint and local build pass. [Contract/evidence/limitations](mail/MAIL_M1E_CID_INLINE_IMAGES.md). **0092 NOT applied to Production; NOT merged to main / NOT deployed; M1F/M2 not started.**
