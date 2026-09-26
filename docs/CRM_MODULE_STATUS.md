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
| Smart Ingest 2 | **YES** | **YES** | NR; Engineering Closeout owner-confirmed, not a test log | **YES — owner confirmed** | **NO** | **NO — 0087–0090 PENDING** | **IMPLEMENTED / HUMAN ACCEPTED / ENGINEERING CLOSEOUT ACCEPTED / NOT PRODUCTION DEPLOYED** | Conversion concurrency risk; Production Release Audit PENDING; preview branch guard mismatch | B; [candidate services](../src/lib/knowledge/knowledge-segment-candidate-service.ts), [compare/convert test](../src/lib/knowledge/knowledge-segment-candidate-compare-convert.integration.test.ts), D/E + 0F-A owner baseline |
| crm-ai | YES; new category task in B | YES | NR | Task-specific scope only; SI2 owner acceptance | Existing Worker YES; new SI2 task NO | Existing Worker version/binding verified; task behavior not probed | DEPLOYED BASE + UNDEPLOYED EXTENSION | Package test script omits category-suggest test; real-AI acceptance not rerun | B/M; [AI service](../workers/crm-ai/src/service.ts), [AI tests](../workers/crm-ai/tests), D/E |
| Backup/Recovery | PARTIAL | YES, subset/export/helper checks | NR | Full recovery acceptance UNKNOWN | Backup Worker YES; branch export code parity UNKNOWN | Worker version only; **restore NOT proven** | **PARTIAL; RECOVERY UNPROVEN** | JSON covers 26 tables, no Mail/Knowledge/object bytes; no demonstrated full restore | B; [backup list](../src/lib/backup/constants.ts), [export](../src/lib/backup/export-data.ts), [safe local helper](../scripts/local-d1-safe-backup.mjs), D/E |
| Preview | YES, several distinct modes | YES, guard/local tests | NR | Historical limited scope only | NOT Production; current Preview deployment state not refreshed | Isolated D1/R2 identities/config; live route/tunnel not verified | AVAILABLE WITH SCOPE LIMITS | SI2 branch not allowed by deploy guard; shared live AI; prototype Mail; local configs can reference Production names | B/M; [preview guard](../scripts/deploy-knowledge-preview.mjs), [config](../wrangler.knowledge-preview.jsonc), E |
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
| Latest exact test execution | NOT IMPORTED; no new test execution in 0E/0F-A/0F-B. |
| GitHub feature backup | Exact B pushed/verified in authorized 0B; no push in 0F-A. |
| Production Deployed | **NO**. |
| Migrations 0087–0090 | **PENDING**, 0D-C metadata evidence. |
| Production Release Audit | **PENDING**. |
| Permission to merge/deploy/migrate | **NOT GRANTED by 0F-A or 0F-B**. |

The 14 commits after M cover candidate foundations, category mapping/suggestion/override, persistent cards, independent organization/hydration, incremental materialization, lineage stability, compare/convert, Open Draft and closeout. Their collective acceptance does not imply individually imported test reports or per-step signed acceptance. Candidate conversion concurrency remains an open release-review item; it does not erase the owner's stated acceptance.

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
