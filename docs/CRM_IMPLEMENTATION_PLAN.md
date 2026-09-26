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

Final documentation review is APPROVED — 2026-09-26. Current 0F-C authorization covers review-status-only finalization, one docs-only commit and the matching feature-branch push. No feature fix, test-suite run, deploy, migration or other GitHub change is authorized by this document. Existing Smart Ingest 2 Human Acceptance and Engineering Closeout remain accepted; its Production release is pending. Evidence shorthand **B** means the feature HEAD in this document header; **M** means its stated main baseline, as defined in the [module register](CRM_MODULE_STATUS.md#evidence-legend).

## P0 — confirmed correctness/security blockers

**No new confirmed P0 blocker was established by 0E.** This is a scoped audit outcome, not proof that the system has no critical defects. Candidate conversion concurrency is a source-observed risk, not a reproduced Production incident. A new confirmed critical issue must be described with evidence and brought to the owner; this register does not permit unilateral Production intervention.

## P1 — approved or release-blocking workflow work

No P1 implementation below has been approved by the owner in 0F-A or 0F-B. Items marked release-review gate require resolution or an explicit risk decision before the relevant release; classification does not authorize a fix. Owner-confirmed rules are recorded as such, while verification/remediation still needs separate scope.

### P1-01 — Candidate conversion concurrency

- **Status:** OPEN — source-observed integrity risk; Smart Ingest 2 release-review item. Sequential idempotency exists; concurrent/failure-path behavior is not established.
- **Evidence:** [Conversion service](../src/lib/knowledge/knowledge-segment-candidate-convert-service.ts) checks existing linkage, creates an Article and then updates candidate linkage separately. [Integration test](../src/lib/knowledge/knowledge-segment-candidate-compare-convert.integration.test.ts) checks sequential reuse. Source: `d9e94c37fb1af503a116663b8da667db4d7fa6dd` / 0E.
- **Why it matters:** Two concurrent requests can both see no link and create Articles; a failed subsequent candidate update can leave an orphan. No Production incident was reproduced, and SI2 is not deployed there.
- **Dependency:** Approved D1-compatible atomicity/idempotency design, candidate/article/audit schema behavior, any required migration and an isolated failure/concurrency test environment.
- **Human approval state:** **HUMAN APPROVAL REQUIRED** for a fix and for the release risk disposition. Existing feature acceptance is not approval to deploy with an undocumented risk.
- **Acceptance criteria:** Actual simultaneous/retried/failing requests have a defined single canonical Article outcome or recoverable documented state; no silent orphan/duplicate; preserve segment scope, category/permission checks, fresh comparison, multiple candidates per Source and Open Draft. Record tests and owner risk decision before release.

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

- **Status:** PENDING — release gate, not additional feature acceptance. SI2 is implemented, Human Accepted and Engineering Closeout Accepted; **NOT PRODUCTION DEPLOYED**.
- **Evidence:** B contains 14 commits after main; 0D-C verified 0084–0086 APPLIED and 0087–0090 PENDING. [Preview guard](../scripts/deploy-knowledge-preview.mjs) does not allow this branch. [Runbook](CRM_DEPLOYMENT_RUNBOOK.md) records main/AI/schema dependencies.
- **Why it matters:** Main code, candidate schema and the new AI task must be compatible; branch acceptance alone does not supply tested release artifacts or recovery approval.
- **Dependency:** P1-01 disposition, recovery checkpoint, exact relevant test results, approved Preview/validation scope, migration/index review and exact release SHA.
- **Human approval state:** **HUMAN APPROVAL REQUIRED** for a release audit beyond this gate, guard changes, merge/push, migrations and each deployment. Neither 0F-A nor 0F-B approves these actions.
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
