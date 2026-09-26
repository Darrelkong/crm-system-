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

# ECHFRONT CRM — implementation review queue

**This document is not permission to implement any item automatically.** It records 0E evidence, 0F-B owner-confirmed product rules/directions and proposed verification/acceptance checks. Priority is an engineering assessment of risk/importance, not implementation authorization. Confirmed product direction, current implementation, permission to change code and permission to release are distinct. Team Member is the preferred product term for internal `staff` roles; code identifiers remain unchanged.

Final documentation review is APPROVED — 2026-09-26. The historical 0F-C authorization covered review-status-only finalization, one docs-only commit and the matching feature-branch push. No feature fix, test-suite run, deploy, migration or other GitHub change is authorized by this document. Existing Smart Ingest 2 Human Acceptance and Engineering Closeout remain accepted; its Production release is pending. Evidence shorthand **B** means the feature HEAD in this document header; **M** means its stated main baseline, as defined in the [module register](CRM_MODULE_STATUS.md#evidence-legend).

## 1A / 1B-A release gate update — 2026-09-26

1A completed with **REMEDIATION REQUIRED BEFORE VALIDATION**. The owner separately authorized 1B-A local changes for PATCH authorization, conversion atomicity, lifecycle/freshness races, human override priority, legacy query scope and directly required tests. This authorization does not extend to unrelated backlog, Preview, real AI, Production queries/migrations, deployments, merge or push. The remediation remains an uncommitted diff on `feat/knowledge-smart-ingest-2` based on `86c33c4c5e3a0a8ce91a167ed11407d42d44cd24`.

Local implementation and validation evidence is recorded in [module status](CRM_MODULE_STATUS.md#1b-a-local-remediation-evidence). Next gate: **CHAT REVIEW BEFORE 1B-B FULL VALIDATION**. Existing Human Acceptance / Engineering Closeout remain recorded; Smart Ingest 2 remains **NOT PRODUCTION DEPLOYED**. No new migration is introduced.

**1B-A3 superseding closure authorization — 2026-09-26:** Remote Chat review passed with one product clarification and small test completion. The owner resolved manual category clear as a persistent human override and authorized an explicit restore-automatic action in the existing Candidate PATCH/UI, focused local tests, and one local checkpoint commit after tests pass: `fix(knowledge): harden smart ingest release blockers`. This supersedes the earlier uncommitted-worktree description once that checkpoint is created; it does not authorize push, merge, Production work or starting 1B-B. See [closure evidence](CRM_MODULE_STATUS.md#1b-a3-final-closure-evidence).

**Retain for 1B-B:** Direct delayed provider-result comparison-completion race testing. The existing commit-time predicate remains unchanged; the earlier no-match race test does not cover that provider-result execution path. Do not expand this closure into full validation.

## 1B-B1c local validation closure — 2026-09-26

**1B-A and 1B-B1a APPROVED / CLOSED; 1B-B1 LOCAL VALIDATION COMPLETE, pending Chat final diff review.** Current local checkpoint remains `09971eafc4590d45fb20e9df613728451cedf27f`; the B1R validation additions and B1c narrow MIME type predicate, source-only Worker typecheck and status notes remain uncommitted. This supersedes the earlier pending-local-validation statements, while preserving historical findings.

[Final local evidence](CRM_MODULE_STATUS.md#1b-b1c-final-local-validation-closure--2026-09-26) retains accepted 436 static and 246 D1 passes, adds source-restore 14 and source-vision-ingest 3 passes, and records successful crm-ai contracts/Vision, production-source semantic typecheck, Wrangler dry-run, Next.js/OpenNext builds, main-app TypeScript and changed-file checks. The deferred provider-result completion race was directly exercised in B1R; it is no longer an unexecuted local item.

The repeatable crm-ai source gate is `npm run crm-ai:typecheck` **and** production-config Wrangler dry-run **and** relevant behavior/contract tests. Full Worker development-tree tsc still reports 14 pre-existing non-production errors (tests 3 / remote-dev scripts 11 / production source 0 / tooling-config 0): **P3 CRM-AI TYPECHECK MAINTENANCE DEBT**, separately scoped future work. Broad package test aggregation remains P3 maintenance; explicit release-suite execution supplies current evidence, and omitted scripts must not be mistaken for executed coverage.

**NEXT: CHAT FINAL B1 REVIEW → separately authorized 1B-B2 isolated remote Preview, browser and real-AI validation → separate Production release approval.** No commit/push is authorized by this record. Smart Ingest 2 remains **NOT PRODUCTION DEPLOYED**; known Production migration baseline is still 0084–0086 applied / 0087–0090 pending, without new remote verification. All four required migrations must precede new crm-system deployment under the runbook and explicit release authorization. Production mock/test flags must both be off at the later preflight.

## P0 — confirmed correctness/security blockers

0E established no new P0 at its earlier scope. **1A subsequently confirmed P0-1: candidate PATCH mutated before action/source authorization.** The authorized 1B-A diff corrects the order and uses a single guarded update; denied/invalid requests are checked against complete before/after candidate rows in isolated D1 tests. This is a local remediation awaiting review, not a claim that Production was affected or repaired. See [security correction](CRM_SECURITY_AND_PERMISSIONS.md#1b-a-candidate-mutation-correction--2026-09-26).

## P1 — approved or release-blocking workflow work

No P1 implementation below was approved by 0F-A or 0F-B; the later 1B-A authorization is limited to the Smart Ingest 2 release blockers listed above. Items marked release-review gate require resolution or an explicit risk decision before the relevant release; classification does not authorize a fix. Owner-confirmed rules are recorded as such, while verification/remediation still needs separate scope.

### P1-01 — Candidate conversion concurrency

- **Status:** LOCAL REMEDIATION IMPLEMENTED — targeted validation evidence recorded; Chat review and 1B-B full validation pending.
- **Evidence:** [Conversion service](../src/lib/knowledge/knowledge-segment-candidate-convert-service.ts) now conditionally creates Article/version/audit/linkage in a single D1 batch. [Remediation integration tests](../src/lib/knowledge/knowledge-candidate-remediation.integration.test.ts) exercise simultaneous actors, four injected SQL failure boundaries, uncertain commit response, lifecycle races and three distinct candidate Articles.
- **Why it matters:** The former split-write path at `d9e94c3` could create duplicates/orphans. This was a release blocker, not a reproduced Production incident; SI2 remains undeployed.
- **Dependency:** Current schema through 0090 suffices; 0087–0090 are unchanged and no 0091 is created. SQL commit conditions protect source/segment/analysis eligibility, classification revision and current organization/comparison.
- **Human approval state:** 1B-A local remediation/tests explicitly authorized. **CHAT REVIEW REQUIRED** before 1B-B; Production release actions remain separately gated.
- **Acceptance criteria:** One canonical Article/version 1/create audit/linkage, no partial failure residue, safe replay/recovery, segment isolation, human classification priority and correct multi-Article Open Draft linkage. Broader migration-upgrade, build/browser/real-AI Preview and recovery validation remain outside 1B-A.

### P1-02 — Backup/restore completeness

- **Status:** OPEN — recovery capability incomplete/unproven; data-affecting release checkpoint.
- **Evidence:** [Backup constants](../src/lib/backup/constants.ts) list 26 tables; [exporter](../src/lib/backup/export-data.ts) has selective fields. Mail, Knowledge, authorized-device state and R2 bytes are not fully covered. 0C/0E found recovery assets, not a full-system restore rehearsal. Deployed backup Worker is older than branch code.
- **Why it matters:** A successful JSON export cannot restore all current modules, file references, credentials/session policy or cross-object integrity after a damaging change.
- **Dependency:** Owner-selected scope, RPO/RTO, private storage/retention policy, isolated restore target and approved D1/R2 export scope.
- **Human approval state:** **HUMAN APPROVAL REQUIRED** for recovery work, any Production export/access and rehearsal involving sensitive data. Do not upload backup content to Git.
- **Acceptance criteria:** Coverage matrix names included/excluded tables, fields, objects and configuration; protected checkpoint can be restored to an isolated environment; constraints/object links/representative workflows pass recorded checks; exclusions and recovery time/data-loss limits are explicitly accepted. Preserve existing assets until disposition is authorized.

### P1-03 — Large attachment cleanup verification

- **Status:** OPEN — operational verification gap; not a confirmed leak or instruction to delete objects.
- **Evidence:** [Large attachment services](../src/lib/mail/large-attachment) implement remove/discard cleanup and delivery-token expiry. [Mail jobs Worker](../workers/mail-jobs-cron.ts) handles background work, but 0E did not establish complete periodic physical cleanup for all large objects. Live R2 lifecycle/CORS/object state was not queried.
- **Why it matters:** Expired download authority does not prove byte deletion; incomplete or premature cleanup can respectively retain data or break approved/sent attachments.
- **Dependency:** Owner-approved retention semantics for pending approval, sent links, failed uploads and recovery; precise object/metadata ownership map; scoped read-only operational verification before any mutation.
- **Human approval state:** **HUMAN APPROVAL REQUIRED** for further verification beyond existing scope, implementation or R2 deletion/lifecycle changes.
- **Acceptance criteria:** Document each lifecycle state, physical cleanup trigger/owner and retry behavior; verify boundaries with synthetic isolated objects; demonstrate valid pending/sent files survive while eligible expired/unreferenced objects are handled according to approved retention; record any explicitly accepted gap.

### P1-04 — Mail read audit persistence

- **Status:** OPEN — confirmed persistence gap; required coverage/priority awaiting owner decision.
- **Evidence:** `recordMailReadAuditEvent` in [read permissions](../src/lib/mail/message-read-permissions.ts) is a no-op hook. Internal read-state rows are not an audit trail.
- **Why it matters:** Claims of durable mailbox/message/attachment access auditing, especially global supervision reads, would currently be inaccurate.
- **Dependency:** Approved event scope, retention, authorized audit viewers, storage/performance/error policy and potential migration.
- **Human approval state:** **HUMAN APPROVAL REQUIRED**; do not invent a compliance obligation or logging policy.
- **Acceptance criteria:** If approved, persist only agreed metadata with actor/action/object/time/access mode; enforce audit-reader permissions; test member/global-read cases and failure policy; exclude raw Mail/credential content; demonstrate persistence and retention without changing send-as or recipient visibility.

### P1-05 — Public GitHub exposure review

- **Status:** OPEN — reported public repository exposure; configuration decision pending. Visibility was carried forward from 0A/0E and not refreshed in 0F-A.
- **Evidence:** Repository `Darrelkong/crm-system-` was recorded PUBLIC in takeover. Tracked configuration/code reveals architecture/resource IDs/business authorization rules. 0E performed limited current-file credential-pattern checks, not a full history audit. `package.json` private flag concerns npm, not GitHub.
- **Why it matters:** Public source has confidentiality implications for this internal CRM even without a proven leaked credential. An unreviewed visibility change could break external integrations or collaborator access.
- **Dependency:** Owner visibility decision; authorized inventory of collaborator, Cloudflare/Git integration and automation dependencies; separately scoped private history/security review if desired.
- **Human approval state:** **HUMAN APPROVAL REQUIRED** for visibility/settings changes, credential rotation or history rewriting. No such action is approved here.
- **Acceptance criteria:** Record actual authorized visibility evidence and dependency impact; document owner choice. If a change is approved, verify intended integrations/access afterward. Any secret findings must be reported without values and handled through a separate concrete remediation decision.

### P1-06 — Smart Ingest 2 Production Release Audit

- **Status:** 1A COMPLETED — REMEDIATION REQUIRED BEFORE VALIDATION. 1B-A local remediation awaits Chat review / 1B-B full validation. Human Acceptance and Engineering Closeout remain recorded; **NOT PRODUCTION DEPLOYED**.
- **Evidence:** B contains 14 commits after main; 0D-C verified 0084–0086 APPLIED and 0087–0090 PENDING. [Preview guard](../scripts/deploy-knowledge-preview.mjs) does not allow this branch. [Runbook](CRM_DEPLOYMENT_RUNBOOK.md) records main/AI/schema dependencies.
- **Why it matters:** Main code, candidate schema and the new AI task must be compatible; branch acceptance alone does not supply tested release artifacts or recovery approval.
- **Dependency:** P1-01 disposition, recovery checkpoint, exact relevant test results, approved Preview/validation scope, migration/index review and exact release SHA.
- **Human approval state:** 1A audit and 1B-A local remediation were separately authorized. Guard changes, full/remote validation, merge/push, Production migrations and deployments remain separately gated; 1B-A does not approve them.
- **Acceptance criteria:** All fourteen runbook gates receive explicit evidence or an owner-approved risk disposition; pending set matches reviewed migrations; permissions/evidence/lineage checks pass in the approved environment; record final main/AI versions and actual migration state after an approved release. Until then keep Production status NO.

### P1-07 — Follow-up product / implementation drift

- **Status:** **PRODUCT / IMPLEMENTATION DRIFT — HUMAN DECISION REQUIRED**. Neither the owner baseline nor current implementation is automatically declared correct for the next change.
- **Evidence:** 0F-B owner confirmation: follow-up content minimum **5 characters**, next action minimum **5 characters**. [Current validation](../src/lib/follow-ups/validation.ts): summary minimum 5, next action minimum **10**, next follow-up at least **45 minutes** ahead. No evidence confirms an owner decision replacing the baseline with the 10/45 rules.
- **Why it matters:** Describing stricter validation as accepted product policy silently changes the baseline; reverting code without a decision would also exceed this gate. Content length currently aligns, while next-action length and scheduling need explicit disposition.
- **Dependency:** Owner decision on intended next-action length and scheduling policy, affected validation/UI/test inventory, and separately scoped implementation authorization if required.
- **Human approval state:** Historical 5-character content/next-action baseline is confirmed. **HUMAN APPROVAL REQUIRED** to resolve the mismatch or change implementation; no application code changes in 0F-B.
- **Acceptance criteria:** Record the explicit product decision with date and rationale, retain both old baseline and observed code evidence, and define approved validation/error-copy/UX checks. Only under later authorization align code/tests/docs and record actual results; do not invent a replacement time interval now.

### P1-08 — Confirmed Public Pool and collaboration rule verification

- **Status:** **HUMAN-CONFIRMED PRODUCT RULE / IMPLEMENTATION VERIFICATION REQUIRED** for incompletely established lifecycle/UI behavior; implemented primitives are identified separately.
- **Evidence:** Owner 0F-B confirms per-member claiming controls, new-member default DISABLED, disabled copy **暂无可领取客户资源** or approved localization, no reclaim from claim disabling, long-term collaboration, explicitly selected approved temporary-expiry exceptions only, and release confirmation/reason/previous-owner history. [Policy route](../src/app/api/admin/users/[id]/public-pool-policy/route.ts) implements pause/quota/cooldown without customer mutation; [member policy](../src/lib/public-pool/member-policy.ts) applies overrides. Schema pause default is `0`, with a separate 45-day protection mechanism. [Collaboration detection](../src/lib/reclamation/collaborative.ts) excludes ordinary reclaim; [release](../src/lib/public-pool/service.ts)/[reclaim](../src/lib/reclamation/engine.ts) preserve previous-owner metadata.
- **Why it matters:** Existing primitives do not prove new-member default-disabled intent or complete UI/lifetime compliance. Individual collaborator inactivity must not become removal authority, and claim disabling must not become a customer ownership mutation.
- **Dependency:** Separately approved verification scope covering creation/eligibility/copy, owned-customer preservation, customer/relationship inactivity, explicit temporary-rule selection, release confirmation and Admin history/privacy.
- **Human approval state:** Product rules are CONFIRMED; **HUMAN APPROVAL REQUIRED** for implementation verification beyond this documentation pass, any remediation or Production action. No need to re-decide the already-confirmed direction.
- **Acceptance criteria:** Use approved isolated scenarios to establish new-member default-disabled behavior, Admin per-member overrides, disabled localized state without privacy leakage, no automatic reclaim upon claim disabling, and no collaborator removal merely for individual silence. Verify any approved selected temporary exception separately. Confirm release reason/history and previous-owner Admin presentation without pre-claim disclosure. Report observed gaps rather than silently fixing code.

## P2 — UX / maintenance debt

### P2-01 — Mail hybrid UI

- **Status:** OPEN — PARTIAL / HYBRID module, not a blanket rewrite request.
- **Evidence:** [Mail page](../src/app/(dashboard)/mail/page.tsx), [prototype state](../src/lib/mail/prototype/state.tsx), [read-source selector](../src/lib/mail/client/mail-read-source.ts) and current Mail components combine real backend paths with fixture/prototype-dependent templates/shared processing/notes and placeholder settings.
- **Why it matters:** A visible action can look durable while lacking a complete server workflow; acceptance must identify the actual feature and data mode.
- **Dependency:** 0F-B confirmed direction includes independently controlled per-member access/workflow, mailbox/sender separation and multiple approved sender identities, From and validated arbitrary To/Cc/Bcc, Team Member approval, authorized Admin direct send, rich text, fixed text/image signatures with user-managed layout and approximately 100 MB files within technical limits. Map remaining UI/backend gaps and obtain a concrete implementation scope.
- **Human approval state:** Product direction above is confirmed. **HUMAN APPROVAL REQUIRED** for each implementation/release slice. Read receipts and LATER auto-reply are confirmed future direction, not permission to enable them; click tracking remains unapproved. Preserve accepted Mail approval behavior.
- **Acceptance criteria:** For each approved slice, document real versus fixture data, implement persistence and negative permission checks where required, verify refresh/mobile behavior and accepted side effects, and update module status without calling the whole Mail Center complete.

### P2-02 — Documentation debt and human product review

- **Status:** 0F-A: PASS WITH REQUIRED REVISIONS; 0F-B: CORRECTIONS COMPLETED; 0F FINAL DOCUMENTATION REVIEW: APPROVED — 2026-09-26. Open decisions and historical files remain preserved.
- **Evidence:** Seven current CRM documents plus updated [AGENTS](../AGENTS.md); historical authority labels in [module status](CRM_MODULE_STATUS.md#historical-document-index).
- **Why it matters:** Old deployment, test, phase and permission claims conflict with current source. Technical evidence cannot reconstruct every historical business rationale.
- **Dependency:** Final Chat review of corrections is completed and approved; remaining open decisions and any missing exact acceptance/test/release artifacts remain documented.
- **Human approval state:** 0F-B corrections are completed. 0F-C is **AUTHORIZED FOR DOCS-ONLY COMMIT AND FEATURE-BRANCH PUSH**. **HUMAN APPROVAL REQUIRED** for implementation, subsequent release work and Word generation.
- **Acceptance criteria:** Review resolves or explicitly retains open decisions; documents remain consistent with code/schema and dated Production evidence; no secrets or invented approvals; only authorized files changed. Future Word handoff is created only in its separately authorized post-review gate.

### P2-03 — Test entry-point coverage

- **Status:** OPEN — explicit-script coverage debt, not evidence that tests fail.
- **Evidence:** [package.json](../package.json) enumerates test files. `crm-ai:test` omits [category-suggest test](../workers/crm-ai/tests/knowledge-category-suggest.test.ts); 0E's 772-file inventory exceeds individual entry-point lists. No full suite was rerun in 0E/0F-A/0F-B.
- **Why it matters:** A green named command can miss changed-domain tests and therefore be misreported as full coverage.
- **Dependency:** Approved test inventory/entry-point policy, local D1 isolation and runtime/resource budget.
- **Human approval state:** **HUMAN APPROVAL REQUIRED** for test-script changes/full validation outside this documentation gate.
- **Acceptance criteria:** Map each release-relevant suite to a maintained invocation; include new AI/SI2 coverage, negative permissions and concurrency where relevant; show isolation; record actual command/SHA/results and unrun scope. Do not add tests that merely assert documentation wording.

### P2-04 — Locale and evidence-presentation maintenance

- **Status:** OBSERVED DEBT — no approved UI overhaul or confirmed universal translation defect.
- **Evidence:** 0E found matching key sets/generated locale JSON but also hardcoded strings, raw-key fallback and historical mixed-language notifications. [Locale generation script](../scripts/generate-locale-json.ts) runs during predev/prebuild/prepreview.
- **Why it matters:** Key parity is not full translation or UX quality; generated files can change during unrelated validation.
- **Dependency:** Named affected screens/languages, owner priority and approved copy; source/generated-file convention.
- **Human approval state:** **HUMAN APPROVAL REQUIRED** for remediation beyond documentation.
- **Acceptance criteria:** Approved screens use intended locale/copy, generated keys remain consistent, dynamic errors do not expose raw keys unexpectedly, and checks cover the affected views without rewriting historical data unasked.

## P3 — repository-observed possible future capability

Unconfirmed capabilities remain **HISTORICAL PROPOSAL — NOT CURRENTLY APPROVED** or **HUMAN DECISION REQUIRED**. P3-03 is different: read receipts and LATER auto-reply are **CONFIRMED FUTURE PRODUCT DIRECTION — NOT IMPLEMENTED / NOT RELEASE APPROVED**. None is a scheduled implementation milestone or execution permission. Product confirmation must not be confused with implementation/release authorization.

### P3-01 — Customer Merge

- **Status:** DISABLED; HISTORICAL PROPOSAL — NOT CURRENTLY APPROVED.
- **Evidence:** [Merge-disabled regression](../src/lib/approvals/service-merge-disabled.test.ts) and current approval service reject it despite a schema/type placeholder.
- **Why it matters:** Merging affects identity uniqueness, ownership, approvals, histories and linked records; enabling a placeholder is not a finished workflow.
- **Dependency:** Explicit product decision, data-integrity/permission design, conflict/recovery plan and scoped implementation authorization.
- **Human approval state:** **HUMAN APPROVAL REQUIRED**. Keep disabled now.
- **Acceptance criteria:** First obtain written scope and acceptance rules; only then design/test conflict handling and traceability under a separate task. Presence in this plan cannot satisfy that gate.

### P3-02 — Scanned PDF OCR

- **Status:** UNSUPPORTED; HUMAN DECISION REQUIRED.
- **Evidence:** [Source extraction](../src/lib/knowledge/source-extraction.ts) handles text-layer PDFs and separate supported image vision; no scanned-PDF OCR pipeline is established.
- **Why it matters:** Page/image conversion, model cost, evidence order, extraction quality and failure review are additional product/technical choices.
- **Dependency:** Accepted formats/page limits, privacy/cost policy and evidence/quality acceptance design.
- **Human approval state:** **HUMAN APPROVAL REQUIRED**. Image vision acceptance does not approve PDF OCR.
- **Acceptance criteria:** Approve scope and measurable extraction/evidence usability requirements before implementation; preserve original evidence and explicit failure states. No automatic fallback is authorized now.

### P3-03 — Mail read receipts and LATER auto-reply

- **Status:** **CONFIRMED FUTURE PRODUCT DIRECTION — NOT IMPLEMENTED / NOT RELEASE APPROVED** for external read receipts and automatic reply; automatic reply is a **LATER** direction. Mail remains PARTIAL / HYBRID.
- **Evidence:** Owner 0F-B explicitly confirms both directions. [Mail prototype](../src/lib/mail/prototype) and grant/schema concepts do not establish a working auto-reply handler or external read receipts. Internal [read-state schema](../drizzle/schema/mail-message-read-states.ts) is not a recipient receipt feature.
- **Why it matters:** Preserve the confirmed direction without inventing implementation or release readiness. Auto-reply adds outbound effects; receipt behavior needs concrete privacy/recipient semantics and does not imply click tracking.
- **Dependency:** Separate scoped designs for receipts and later auto-reply, approved implementation priority, sender/approval/privacy rules, operational safeguards and test-recipient scope. No particular receipt tracking mechanism is approved here.
- **Human approval state:** Future product direction CONFIRMED. **HUMAN APPROVAL REQUIRED** for implementation, specific mechanisms/privacy decisions and release; no silent enablement. External click tracking is separately unapproved in P3-05.
- **Acceptance criteria:** Preserve separate direction/implementation/release records; obtain concrete behavior, security and validation criteria before coding. Future verification must distinguish internal read state from external receipts and prove authorized auto-reply behavior. Mock UI/grants alone cannot meet acceptance; current code remains unchanged.

### P3-04 — Customer attachments and standalone Contacts

- **Status:** Full capability not established; HISTORICAL PROPOSAL — NOT CURRENTLY APPROVED.
- **Evidence:** Customer contacts/identifiers exist in [schema](../drizzle/schema), while [historical requirements](PHASE_17_REQUIREMENTS.md) include broader proposals. Mail attachment implementation is not a customer attachment subsystem.
- **Why it matters:** Object ownership, contact permissions, customer lifecycle, duplicate rules, retention and recovery need product decisions.
- **Dependency:** Named user workflows, authorization and file/storage limits, recovery coverage and owner priority.
- **Human approval state:** **HUMAN APPROVAL REQUIRED**. Do not infer approval from historical requirements.
- **Acceptance criteria:** Approve a concrete scope and permissions/lifecycle specification first; preserve existing customer/Mail boundaries. Future work gets its own tests/acceptance record rather than being backdated as current functionality.

### P3-05 — External Mail click tracking

- **Status:** **NOT APPROVED / HUMAN DECISION REQUIRED**; NOT IMPLEMENTED. Read-receipt confirmation does not approve click tracking.
- **Evidence:** 0F-B explicitly leaves click tracking open; current Mail implementation has no established external click-tracking capability.
- **Why it matters:** Click tracking is a separate recipient-privacy/product choice and must not be bundled into confirmed read receipts.
- **Dependency:** Explicit owner decision on whether it is wanted, then scoped privacy/authorization design and implementation/release approval if chosen.
- **Human approval state:** **HUMAN APPROVAL REQUIRED** for product adoption, implementation and release; none granted.
- **Acceptance criteria:** Keep status unapproved unless separately confirmed; do not introduce tracking in receipt work. If later approved, record its own decision and concrete acceptance criteria before implementation.

## Review and promotion rule

Record which dimension an owner instruction confirms: product direction, implementation scope or release authorization. 0F-B confirms named product rules/directions and authorizes documentation corrections only. Record date, permitted actions and acceptance criteria before promoting another dimension. Execution results must reference a SHA and environment. Production action always needs target-specific authorization. Do not infer consent from priority, elapsed time, an old phase plan or the word CURRENT in a document header.

## 1B-B2R approval and execution boundary — 2026-09-26

Owner-approved B1 is closed at feature checkpoint `a11822fd60f5ba1123b996e9d58b74542304f329`. B2R permits only the named isolated Preview D1 `crm-db-si2-preview`, R2 `crm-knowledge-si2-preview`, AI Worker `crm-ai-si2-preview`, and CRM Worker `crm-system-knowledge-preview`; old Preview and Production resources are preserved. See the updated deployment runbook for strict bindings, exact-SHA deployment and migration verification. One logical Preview-isolation commit and non-force feature push are authorized by the current owner request, not by this document.

Infrastructure, migrations and synthetic service/real-AI checks may proceed without browser login. Browser controls, Open Draft, reload and browser permission/stale-state acceptance remain **DEFERRED — HUMAN ACCESS REQUIRED**. No Access change or authentication workaround is authorized. Record actual remote evidence separately; configuration alone does not establish deployed isolation or B2 PASS. Next: complete isolated infrastructure/service evidence → human browser acceptance → separate Production preflight/approval. Smart Ingest 2 remains **NOT PRODUCTION DEPLOYED**.
