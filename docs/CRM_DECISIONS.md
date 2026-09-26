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

# ECHFRONT CRM — durable decision log

Current documentation corrected in 0F-B after Chat/Human review (2026-09-26). Open decisions remain documented. Entries distinguish observed implementation from owner-confirmed product rules/direction. **2026-09-26 is the recording/confirmation date, not an invented original adoption date.** Unless explicitly stated, original adoption dates and historical business rationale remain unknown. Product confirmation is not implementation or release authorization. Team Member is the user-facing term for internal `staff` identifiers.

Current code/schema/tests outrank old proposals. Tests cited here establish intended coverage, not a fresh pass. Feature HEAD is `d9e94c37fb1af503a116663b8da667db4d7fa6dd`; the [module register](CRM_MODULE_STATUS.md) separates Production status. Decisions affecting SI2 remain **NOT Production deployed**, with 0087–0090 pending.

## CRM-D001 — Team Member Public Pool random claim

- **Date:** 2026-09-26 (recorded; original adoption date not established here).
- **Decision ID:** CRM-D001.
- **Status:** OBSERVED CURRENT; retained baseline, not a new policy approval.
- **Decision:** Team Member claim through the random-claim workflow with server eligibility/quota/cooldown; Admin has a separate ID-based path.
- **Reason:** Current code explicitly rejects Team Member ID claims and selects from eligible oldest candidates. Historical rationale requires Human confirmation.
- **Evidence:** [Random claim service](../src/lib/public-pool/random-claim-service.ts), [ID-claim tests](../src/app/api/public-pool/customers/id-claim-route.test.ts), [pool completion record](PUBLIC_POOL_3B_COMPLETION.md).
- **Affected modules:** Public Pool, customer ownership, Team Member policy.
- **Supersedes / superseded by:** Incompatible historical assumptions of Team Member ID selection are superseded by current behavior; extended by CRM-D016 per-member policy without changing random claim.

## CRM-D002 — Team Member pre-claim privacy

- **Date:** 2026-09-26 (recorded).
- **Decision ID:** CRM-D002.
- **Status:** OBSERVED CURRENT.
- **Decision:** Team Member pre-claim data is restricted server-side; empty Team Member SSR, masked desktop list and mobile list omission do not replace API authorization.
- **Reason:** Implementation prevents customer-detail/contact leakage before authorized claim. Historical rationale requires Human confirmation.
- **Evidence:** [Customer permissions](../src/lib/permissions/customers.ts), [pool API tests](../src/lib/permissions/public-pool-detail-api.test.ts), [Team Member desktop loader](../src/app/(dashboard)/public-pool/staff-desktop-public-pool-loader.tsx).
- **Affected modules:** Public Pool, customer API/UI, mobile.
- **Supersedes / superseded by:** Any historical client-only masking assumption; none recorded later.

## CRM-D003 — Access, CRM session and Knowledge unlock separation

- **Date:** 2026-09-26 (recorded).
- **Decision ID:** CRM-D003.
- **Status:** OBSERVED CURRENT.
- **Decision:** Cloudflare Access verification, CRM login/session/device state and Knowledge secondary unlock/role are distinct layers. Team Member Access email binding is separate from ordinary CRM account identity.
- **Reason:** Server gates represent different identity/session/domain capabilities. Historical rationale requires Human confirmation.
- **Evidence:** [Access validation](../src/lib/auth/access-jwt.ts), [session](../src/lib/auth/session.ts), [Team Member binding](../src/lib/auth/staff-access-email-binding.ts), [Knowledge unlock](../src/lib/knowledge/unlock-service.ts).
- **Affected modules:** Auth, Team Member/Admin, Knowledge.
- **Supersedes / superseded by:** Older docs that conflate Access expiry with CRM session or describe idle policy as unimplemented; CRM-D018 adds owner-confirmed intended durations without merging the controls.

## CRM-D004 — Business taxonomy and Knowledge Category are distinct

- **Date:** 2026-09-26 (recorded).
- **Decision ID:** CRM-D004.
- **Status:** OBSERVED CURRENT; SI2 mapping extension owner-accepted, not deployed.
- **Decision:** Requested business/project identity is not the Knowledge Category taxonomy. Mapping is explicit and editable through authorized administration, not hardcoded identity equivalence.
- **Reason:** Separate persisted fields and mapping service support the distinction. Historical rationale requires Human confirmation.
- **Evidence:** [Business identity](../src/lib/knowledge/knowledge-paste-business-identity.ts), [mapping service](../src/lib/knowledge/knowledge-business-category-mapping-service.ts), [0087](../drizzle/migrations/0087_knowledge_business_category_mappings.sql).
- **Affected modules:** Customer business catalog, Knowledge, Smart Ingest.
- **Supersedes / superseded by:** No formal historical decision ID identified; automatic taxonomy equivalence is incompatible with current code.

## CRM-D005 — Canonical Knowledge article language

- **Date:** 2026-09-26 (recorded).
- **Decision ID:** CRM-D005.
- **Status:** OBSERVED CURRENT for organizer output.
- **Decision:** Knowledge organizer targets Simplified Chinese canonical article title/summary/body while preserving supported facts/proper names. Comparison normalization is a distinct operation. This does not mandate rewriting all source text or historical articles.
- **Reason:** Current organizer prompt/normalization/quality checks implement that output contract. Historical rationale requires Human confirmation.
- **Evidence:** [Organization execution](../src/lib/knowledge/knowledge-organization-execution.ts), [article quality](../src/lib/knowledge/knowledge-organizer-article-quality.ts), [quality tests](../src/lib/knowledge/knowledge-article-quality-hotfix.test.ts).
- **Affected modules:** Knowledge organizer, comparison, source evidence.
- **Supersedes / superseded by:** No historical decision ID identified; none recorded later.

## CRM-D006 — Human override priority

- **Date:** 2026-09-26 (recorded).
- **Decision ID:** CRM-D006.
- **Status:** SI2 IMPLEMENTED / HUMAN ACCEPTED; NOT PRODUCTION DEPLOYED.
- **Decision:** Human business/category override wins over explicit mapping and automatic AI suggestion. Confidence controls how suggestions are offered/adopted; uncertain suggestions do not silently become accepted facts.
- **Reason:** Manual override flags and classification logic preserve user corrections across automatic refresh/materialization. Historical rationale requires Human confirmation.
- **Evidence:** [Candidate classification](../src/lib/knowledge/knowledge-segment-candidate-classification.ts), [candidate service](../src/lib/knowledge/knowledge-segment-candidate-service.ts), [autofill tests](../src/lib/knowledge/knowledge-ingest-category-autofill.integration.test.ts), owner 0F-A acceptance baseline.
- **Affected modules:** Smart Ingest, category mapping/suggestion/UI.
- **Supersedes / superseded by:** No formal predecessor identified; automatic overwriting of manual choices is incompatible with this baseline.

## CRM-D007 — Candidate segment isolation and evidence fidelity

- **Date:** 2026-09-26 (recorded).
- **Decision ID:** CRM-D007.
- **Status:** SI1 source/segment boundary present; SI2 candidate workflow owner-accepted, not deployed.
- **Decision:** Candidate organization/comparison uses its confirmed segment evidence and stable lineage. Knowledge AI must not invent unsupported evidence. Explicit human extraction corrections are distinct from AI rewriting.
- **Reason:** Scope guards, evidence offsets and candidate run identifiers enforce separation; grounding checks are bounded and human review remains necessary. Historical rationale requires Human confirmation.
- **Evidence:** [Source scope](../src/lib/knowledge/smart-ingest-source-scope.ts), [candidate organizer](../src/lib/knowledge/knowledge-segment-candidate-organizer-service.ts), [lineage](../src/lib/knowledge/knowledge-smart-ingest-candidate-lineage.ts), [source service](../src/lib/knowledge/source-service.ts).
- **Affected modules:** Knowledge extraction/organization/comparison, Smart Ingest.
- **Supersedes / superseded by:** Legacy whole-source workflow remains only for its permitted scope; it must not substitute for multi-segment candidate processing.

## CRM-D008 — One Source may create multiple Candidate Articles

- **Date:** 2026-09-26 (recorded).
- **Decision ID:** CRM-D008.
- **Status:** SI2 IMPLEMENTED / HUMAN ACCEPTED / ENGINEERING CLOSEOUT ACCEPTED; NOT PRODUCTION DEPLOYED.
- **Decision:** Each candidate owns its draft Article link. A Source can produce multiple Candidate Articles; source-level legacy linkage is not the candidate conversion lock. Reorganization preserves existing draft linkage, and Open Draft uses the canonical Article route.
- **Reason:** Candidate persistence and Article linkage represent independent confirmed topics. Historical rationale requires Human confirmation. Atomic concurrent conversion remains a separate unresolved risk.
- **Evidence:** [0090](../drizzle/migrations/0090_knowledge_candidate_compare_convert.sql), [conversion](../src/lib/knowledge/knowledge-segment-candidate-convert-service.ts), [navigation tests](../src/lib/knowledge/knowledge-candidate-open-draft-navigation.test.ts), [P1-01](CRM_IMPLEMENTATION_PLAN.md#p1-01--candidate-conversion-concurrency).
- **Affected modules:** Smart Ingest candidates, Knowledge Article creation/navigation.
- **Supersedes / superseded by:** Single source-level Article linkage is superseded for SI2 candidates, retained for the legacy source path; none recorded later.

## CRM-D009 — Mail read is not send-as; Team Member revision approval

- **Date:** 2026-09-26 (recorded).
- **Decision ID:** CRM-D009.
- **Status:** OBSERVED CURRENT; Mail module remains PARTIAL / HYBRID.
- **Decision:** Reading/supervising Mail does not grant send-as. Team Member submits immutable revisions for non-self review; Admin direct-send still needs persisted Mail access and sender authorization. CRM root Admin has effective supervision read without automatic sender grants.
- **Reason:** Separate control/read/send/workflow checks and revision hashing implement these boundaries. Historical rationale requires Human confirmation.
- **Evidence:** [Mail permissions](../src/lib/permissions/mail.ts), [outbound approval](../src/lib/mail/outbound-approval-service.ts), [dispatch permissions](../src/lib/mail/outbound-sending-permissions.ts).
- **Affected modules:** Mail access, compose, approval, delivery.
- **Supersedes / superseded by:** Any old plan implying Mail admin/global read automatically permits sending; CRM-D019 adds confirmed Mail direction without changing these authorization boundaries.

## CRM-D010 — Dedicated large-attachment storage and lifecycle

- **Date:** 2026-09-26 (recorded).
- **Decision ID:** CRM-D010.
- **Status:** OBSERVED CURRENT; infrastructure/flags verified in 0D, recovery/cleanup still limited.
- **Decision:** Large files use `crm-mail-large-attachments`, upload/lifecycle metadata and bearer delivery tokens through the mail-files gateway; normal attachments use their separate storage/workflow. Expired links are not proof of byte deletion.
- **Reason:** Current upload, approval and download services use distinct limits and lifecycle controls. Historical rationale requires Human confirmation.
- **Evidence:** [Large attachment services](../src/lib/mail/large-attachment), [gateway](../workers/echfront-mail-files/index.ts), [Production gateway config](../wrangler.echfronthk-mail-files.production.jsonc), 0D binding/version snapshot.
- **Affected modules:** Mail files, R2, gateway, cleanup/recovery.
- **Supersedes / superseded by:** Older bucket/checksum/future-deploy assumptions where inconsistent with current implementation; no later decision recorded.

## CRM-D011 — Canonical Production main deployment path

- **Date:** 2026-09-26 (recorded and explicitly restated by owner in 0F-A).
- **Decision ID:** CRM-D011.
- **Status:** CURRENT OPERATIONAL RULE; no release authorized by documentation.
- **Decision:** Main CRM deploy uses `npm run deploy:production`; no standalone Wrangler substitute for `crm-system`. Other Workers have separately reviewed deployment paths.
- **Reason:** The script enforces reviewed main/origin-main source, clean build artifacts, real-Mail build selection and release metadata. Original historical rationale beyond these safeguards requires Human confirmation.
- **Evidence:** [Production deploy](../scripts/deploy-production.mjs), [release guard](../scripts/production-release-guard.mjs), owner 0F-A instructions.
- **Affected modules:** Deployment, Mail build mode, main/AI/independent Worker coordination.
- **Supersedes / superseded by:** Stale direct-main-deploy instructions in historical docs; no later decision recorded.

## CRM-D012 — Production Mock AI remains off

- **Date:** 2026-09-26 (recorded and restated by owner).
- **Decision ID:** CRM-D012.
- **Status:** CURRENT INVARIANT; Production flag state observed in 0D.
- **Decision:** Mock AI is restricted to explicit development/test scope. Production must not present mock output as real inference; deterministic fallback must retain its distinct source label.
- **Reason:** Current runtime gates and response provenance distinguish mock, real inference and fallback. Historical rationale requires Human confirmation.
- **Evidence:** [Knowledge organization execution](../src/lib/knowledge/knowledge-organization-execution.ts), [dashboard AI](../src/lib/ai/dashboard-insights), [Preview flags](../wrangler.knowledge-preview.jsonc), 0D main binding/flag observation.
- **Affected modules:** AI, Knowledge, dashboard, Preview/Production.
- **Supersedes / superseded by:** No formal predecessor identified; none recorded later.

## CRM-D013 — Customer Merge remains disabled

- **Date:** 2026-09-26 (recorded).
- **Decision ID:** CRM-D013.
- **Status:** OBSERVED CURRENT; owner explicitly requires accurate disabled status in 0F-A.
- **Decision:** Do not expose/enable merge from historical proposals, schema enums or placeholder implementation branches.
- **Reason:** Current service and tests explicitly reject merge. Historical rationale requires Human confirmation.
- **Evidence:** [Approval service](../src/lib/approvals), [merge-disabled test](../src/lib/approvals/service-merge-disabled.test.ts), owner 0F-A instructions.
- **Affected modules:** Customers, approvals, related-data integrity.
- **Supersedes / superseded by:** Old merge proposals are not approved current behavior; no later enabling decision recorded.

## CRM-D014 — Backup existence is not proven restore

- **Date:** 2026-09-26 (recorded and restated by owner).
- **Decision ID:** CRM-D014.
- **Status:** CURRENT EVIDENCE/OPERATIONS RULE; recovery policy still requires human decision.
- **Decision:** Report backup coverage and restore rehearsal separately. Preserve local-only assets until authorized disposition; never certify full recovery from a file or a successful subset export alone.
- **Reason:** Current exporter omits whole domains/object bytes, and 0C/0E did not demonstrate full-system restore. This is an evidence limit, not a newly approved retention schedule.
- **Evidence:** [Backup constants](../src/lib/backup/constants.ts), [exporter](../src/lib/backup/export-data.ts), [local snapshot helper](../scripts/local-d1-safe-backup.mjs), 0C/0E audit findings.
- **Affected modules:** Backup/Recovery, D1/R2, deployment, local asset handling.
- **Supersedes / superseded by:** Broad historical claims equating backup presence with recovery readiness; none recorded later.

## CRM-D015 — Team Member user-facing terminology

- **Date:** 2026-09-26 recorded/confirmed; original adoption date unknown.
- **Decision ID:** CRM-D015.
- **Status:** HUMAN-CONFIRMED PRODUCT/UI INVARIANT; source-code terminology migration not performed or authorized here.
- **Decision:** Preferred user-facing terms are **团队成员** (Simplified Chinese), **團隊成員** (Traditional Chinese) and **Team Member** (English). Internal `staff`, `Staff` and `role=staff` may remain implementation identifiers. Technical tables may say Team Member (internal role: `staff`).
- **Reason:** Owner explicitly confirms the terminology distinction in 0F-B. Historical rationale beyond that confirmation requires Human confirmation.
- **Evidence:** Owner 0F-B section 1; [master roles](CRM_MASTER_SPEC.md#b-user-roles), [AGENTS](../AGENTS.md).
- **Affected modules:** All user-facing CRM terminology and current documentation; internal authorization identifiers unchanged.
- **Supersedes / superseded by:** Supersedes 0F-A wording wherever it could imply Staff is the preferred English product label; no later decision recorded.

## CRM-D016 — Per-Team Member Public Pool claim controls

- **Date:** 2026-09-26 recorded/confirmed; original adoption date unknown.
- **Decision ID:** CRM-D016.
- **Status:** HUMAN-CONFIRMED PRODUCT RULE; primitives IMPLEMENTED IN SOURCE, full default/UI behavior IMPLEMENTATION VERIFICATION REQUIRED.
- **Decision:** Claiming eligibility is independently controlled per Team Member. New Team Members default to claiming DISABLED. Admin controls enable/disable, quota and cooldown; designed member overrides take precedence over global defaults. Disabled UI communicates **暂无可领取客户资源** or approved localization. Disabling claims must not remove/reclaim customers already owned by the member.
- **Reason:** Owner explicitly confirms independent controls and ownership-preservation semantics. Historical rationale requires Human confirmation.
- **Evidence:** Owner 0F-B section 3A; [policy route](../src/app/api/admin/users/[id]/public-pool-policy/route.ts) changes user policy without customer mutation; [member policy](../src/lib/public-pool/member-policy.ts) applies overrides. [User schema](../drizzle/schema/users.ts) defaults pause to `0`; 45-day protection is not proof of the confirmed default-disabled rule.
- **Affected modules:** Public Pool, Team Member administration, claim UI and customer ownership.
- **Supersedes / superseded by:** Extends CRM-D001. Supersedes any inference that timed first-login protection fully proves default-disabled compliance; no later decision recorded.

## CRM-D017 — Long-term collaboration without individual-inactivity removal

- **Date:** 2026-09-26 recorded/confirmed; original adoption date unknown.
- **Decision ID:** CRM-D017.
- **Status:** HUMAN-CONFIRMED PRODUCT RULE / IMPLEMENTATION VERIFICATION REQUIRED for full lifetime/exception behavior.
- **Decision:** Default collaboration is long-term. A collaborator / 协作成员 must not be removed merely because they did not personally write follow-ups: the primary Team Member may handle operations while another provides guidance. Automatic removal is valid only when a specifically approved temporary-expiry/auto-remove rule was explicitly selected. Evaluate inactivity using the customer/relationship workflow, not individual collaborator silence.
- **Reason:** Owner explicitly confirms guidance-only collaboration as valid continuing participation. Further historical rationale requires Human confirmation.
- **Evidence:** Owner 0F-B section 3B; [collaboration detection](../src/lib/reclamation/collaborative.ts) exempts collaborative customers from ordinary reclaim/warnings. That evidence does not prove all lifetime/temporary-rule paths.
- **Affected modules:** Customer collaborators, reclamation, reminders, relationship authorization.
- **Supersedes / superseded by:** Supersedes any interpretation of historical dissolution/reminder proposals as permission to remove individually inactive collaborators; no later decision recorded.

## CRM-D018 — Intended Access duration versus CRM lifetimes

- **Date:** 2026-09-26 recorded/confirmed; original adoption date unknown.
- **Decision ID:** CRM-D018.
- **Status:** OWNER-CONFIRMED POLICY / LIVE CONFIG NOT VERIFIED IN TAKEOVER for Access duration.
- **Decision:** Intended Cloudflare Access session duration is **1 week**. CRM inactivity logout baseline is **30 minutes**. Current source separately implements a **7-day CRM absolute session ceiling**. These are three distinct controls, with existing CRM configuration/exemption handling preserved.
- **Reason:** Owner confirms separate operational controls. The matching Access/CRM absolute durations do not establish a shared session rule. Historical rationale requires Human confirmation.
- **Evidence:** Owner 0F-B section 5; [CRM session constants](../src/lib/auth/constants.ts), [idle configuration](../src/lib/settings/idle-timeout.ts), [security controls](CRM_SECURITY_AND_PERMISSIONS.md). 0D did not audit live Cloudflare Access duration/policy.
- **Affected modules:** Cloudflare Access, CRM auth/session, idle logout, operations.
- **Supersedes / superseded by:** Clarifies/extends CRM-D003; supersedes any inference that 0D verified intended Access duration or that Access validity suppresses CRM idle expiry. No live policy change authorized.

## CRM-D019 — Confirmed Mail product direction and future capabilities

- **Date:** 2026-09-26 recorded/confirmed; original adoption date unknown.
- **Decision ID:** CRM-D019.
- **Status:** HUMAN-CONFIRMED PRODUCT DIRECTION; current Mail remains PARTIAL / HYBRID. External read receipts and LATER auto-reply: **CONFIRMED FUTURE PRODUCT DIRECTION — NOT IMPLEMENTED / NOT RELEASE APPROVED**.
- **Decision:** Each Team Member has independently controlled Mail access/workflow. Mailbox and sender identity are separate; a mailbox may support multiple approved sender identities. Direction includes From selection, arbitrary validated/security-checked To/Cc/Bcc, Team Member approval, authorized Admin direct-send, rich-text compose, fixed signatures with text/images and user-managed layout, and approximately 100 MB large files within implemented technical policy. Read receipts are desired; automatic reply is desired LATER. External click tracking remains **NOT APPROVED / HUMAN DECISION REQUIRED**.
- **Reason:** Owner explicitly confirms these directions while distinguishing implementation and release readiness. Further historical rationale requires Human confirmation.
- **Evidence:** Owner 0F-B section 4; [Mail specification](CRM_MASTER_SPEC.md#j-mail-center), [permissions](../src/lib/permissions/mail.ts), [large-file policy](../src/lib/mail/large-attachment/large-attachment-policy.ts), [future direction item](CRM_IMPLEMENTATION_PLAN.md#p3-03--mail-read-receipts-and-later-auto-reply). Existing primitives do not prove full layout/workflow completion; internal read state is not external receipts.
- **Affected modules:** Mail access/compose/signatures/approval, sender identity, large attachments, future receipts/auto-reply.
- **Supersedes / superseded by:** Extends CRM-D009/CRM-D010. Supersedes 0F-A classification of auto-reply as an unconfirmed historical proposal and separates read receipts from unapproved click tracking. No implementation/release approval follows.

## CRM-D020 — Release confirmation and previous-owner reclaim history

- **Date:** 2026-09-26 recorded/confirmed; original adoption date unknown.
- **Decision ID:** CRM-D020.
- **Status:** HUMAN-CONFIRMED PRODUCT RULE; reason/previous-owner persistence IMPLEMENTED IN SOURCE; complete confirmation/Admin display IMPLEMENTATION VERIFICATION REQUIRED.
- **Decision:** Preserve explicit release confirmation, release reason/history and previous-owner identity in automatic reclaim/audit data. Admin-facing reason/history must identify the original responsible Team Member before reclaim. Preserve ordinary Team Member pre-claim privacy.
- **Reason:** Owner explicitly confirms history/accountability and privacy requirements. Historical rationale beyond those requirements requires Human confirmation.
- **Evidence:** Owner 0F-B section 3C; [release service](../src/lib/public-pool/service.ts), [reclaim engine](../src/lib/reclamation/engine.ts). No new runtime/history UI test was run.
- **Affected modules:** Public Pool release/reclaim, customer audit/history, Admin visibility.
- **Supersedes / superseded by:** Complements CRM-D002 and CRM-D016; no later decision recorded.

## CRM-D021 — Follow-up baseline and unresolved implementation drift

- **Date:** 2026-09-26 recorded/confirmed; original adoption date unknown.
- **Decision ID:** CRM-D021.
- **Status:** **PRODUCT / IMPLEMENTATION DRIFT — HUMAN DECISION REQUIRED**; baseline recorded, resolution OPEN.
- **Decision:** OWNER PRODUCT BASELINE: follow-up content minimum **5 characters**, next action minimum **5 characters**. CURRENT IMPLEMENTATION OBSERVED: summary minimum 5, next action minimum **10**, next follow-up minimum **45 minutes** ahead. Do not silently approve the 10/45 policy or change code to either interpretation in this gate.
- **Reason:** Owner confirms the historical baseline and states insufficient evidence of a deliberate replacement. No resolution rationale or replacement time interval is invented.
- **Evidence:** Owner 0F-B section 2; [validation](../src/lib/follow-ups/validation.ts), [P1-07](CRM_IMPLEMENTATION_PLAN.md#p1-07--follow-up-product--implementation-drift).
- **Affected modules:** Follow-up validation/UI/product specification/tests.
- **Supersedes / superseded by:** Supersedes 0F-A presentation of 10 characters/45 minutes as unqualified product policy; source behavior remains unchanged and decision unresolved.

## CRM-D022 — Dashboard seven-day default presentation

- **Date:** 2026-09-26 recorded/confirmed; original adoption date unknown.
- **Decision ID:** CRM-D022.
- **Status:** HUMAN-CONFIRMED PRODUCT/UI PREFERENCE; no new Production runtime verification.
- **Decision:** Dashboard curve/trend defaults to **7 days**; 7 / 30 / 90 day ranges may remain available where implemented.
- **Reason:** Owner explicitly confirms the default presentation. Historical rationale requires Human confirmation.
- **Evidence:** Owner 0F-B section 6; [Dashboard specification](CRM_MASTER_SPEC.md#i-dashboard--reports).
- **Affected modules:** Dashboard trends and period selector.
- **Supersedes / superseded by:** Adds the previously unspecified product default; no later decision recorded and no runtime implementation claim added.

## Recording future decisions

Add a dated entry when the owner explicitly decides product behavior, approves a scoped implementation or changes an operational boundary. Preserve superseded entries and link both directions. State whether the date is a decision date or only an observation date. Link source/test/release evidence and record Production separately.

Unresolved rationale and unconfirmed future features belong in [open product decisions](CRM_MASTER_SPEC.md#q-open-human-decisions) and the [review queue](CRM_IMPLEMENTATION_PLAN.md), with **HUMAN DECISION REQUIRED** / **HUMAN APPROVAL REQUIRED**. Retain confirmed Mail direction separately from implementation/release approval. Do not invent a reason or approval from an old proposal. **0F FINAL DOCUMENTATION REVIEW: APPROVED — 2026-09-26**. 0F-A: PASS WITH REQUIRED REVISIONS. 0F-B: CORRECTIONS COMPLETED. 0F-C: AUTHORIZED FOR DOCS-ONLY COMMIT AND FEATURE-BRANCH PUSH. The Word handoff requires separate post-review authorization.
