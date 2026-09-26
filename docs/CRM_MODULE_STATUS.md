Document status:
CURRENT

Repository:
Darrelkong/crm-system-

Verified branch:
feat/knowledge-smart-ingest-2

Verified HEAD:
d9e94c37fb1af503a116663b8da667db4d7fa6dd

Last architecture verification:
2026-09-26

Production baseline:
main @ a481689ad3854b85dfa6073c9aa495453659fb58

Important:
Feature implementation status and Production deployment status are separate.

Last Human Product Review:
2026-09-26 — CHAT/HUMAN REVIEW COMPLETED; OPEN DECISIONS REMAIN DOCUMENTED

# ECHFRONT CRM — module status and evidence

Current documentation corrected in 0F-B after Chat/Human review (2026-09-26). Open decisions remain documented. This register deliberately separates source presence, test presence/results, human acceptance, deployment and runtime verification. No row uses "complete" as a substitute for those dimensions.

User-facing **Team Member / 团队成员 / 團隊成員** maps to the internal `staff` role; code identifiers are unchanged. Owner-confirmed product rules/direction are an additional evidence dimension, not proof of implementation, runtime verification or release authorization.

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

## Module register

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

## Smart Ingest 2 acceptance and release ledger

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
