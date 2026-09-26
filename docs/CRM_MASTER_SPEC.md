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

# ECHFRONT CRM — current product specification

Current documentation corrected in 0F-B after Chat/Human review (2026-09-26). The 0F-A review passed with required revisions; those corrections record owner-confirmed product rules separately from implementation and unresolved decisions. The owner supplied the main baseline and confirmed Smart Ingest 2 Human Acceptance and Engineering Closeout; the 0D Cloudflare observations independently establish resource/version metadata and the migration boundary. No application tests were rerun in 0E, 0F-A or 0F-B. See [module status](CRM_MODULE_STATUS.md) for deployment and evidence limits.

Use current source, schema/migrations, tests, 0D verified state, 0E findings, historical documents and historical plans in that order. A test describes intended coverage; a dated execution result proves only the checks actually run. Product rationale not established by these sources requires human confirmation.

This evidence order determines what is implemented. Explicit owner confirmation determines intended product behavior. Where they differ, record **PRODUCT / IMPLEMENTATION DRIFT — HUMAN DECISION REQUIRED**; neither side is silently declared automatically correct or changed by this documentation gate.

## A. Product purpose

ECHFRONT CRM is the internal workspace for managing leads/customers, follow-up responsibility, customer approvals, Team Member/Admin operations, Mail and reviewed Knowledge. It supports desktop and mobile use, with English, Simplified Chinese and Traditional Chinese interfaces. It is separate from ECHFRONT Global Website.

The product connects responsible people to customer work while controlling access to customer information. Mail and Knowledge have their own access rules; a CRM role does not automatically confer every capability in those modules.

## B. User roles

**Confirmed user-facing terminology:** Simplified Chinese **团队成员**; Traditional Chinese **團隊成員**; English **Team Member**. Internal identifiers `staff`, `Staff` and `role=staff` may remain as implementation terminology. A technical reference to Team Member means the internal `staff` role unless qualified otherwise. This rule does not authorize a source-code terminology refactor or certify all current UI strings as migrated.

| Role or capability | Current product meaning |
| --- | --- |
| Team Member (internal role: `staff`) | Work on owned/assigned customers, permitted follow-ups, requests and personal work items; use Public Pool random claim when eligible. |
| CRM Admin | Customer and Team Member administration, approval handling, operational settings and broader reports. Specific module rules still apply. |
| Customer primary owner | Responsible for the customer; collaborator membership does not transfer ownership. |
| Customer collaborator/assignee | Permitted customer visibility and follow-up work, without automatic master-record editing or ownership authority. |
| Knowledge viewer | Read permitted published Knowledge after secondary access is unlocked. |
| Knowledge contributor | Author/submit permitted articles and manage owned sources. |
| Knowledge reviewer | Review permitted submissions; this role alone does not grant authoring/ingest. |
| Knowledge administrator | Knowledge policy/roles/categories and permitted content administration. |
| Mail user, member, delegate, reviewer | Separately provisioned access and grants govern reading, administration, approval and sending. |

The [authorization matrix](CRM_SECURITY_AND_PERMISSIONS.md) is the reference for action-level distinctions.

## C. CRM operating principles

- Server authorization controls data and actions; hiding a button is not a security boundary.
- Primary ownership, collaboration, customer status, sales stage and post-payment lifecycle are separate concepts.
- Sensitive transitions use dedicated workflows. Ordinary edits do not bypass approvals, ownership transfer or release-to-pool rules.
- Duplicate contact identity checks and normalized identifiers protect customer consistency.
- Operational evidence is retained through appropriate histories/audit records; coverage is not universal, particularly Mail read audit persistence.
- Human review controls Knowledge publication and Team Member outbound mail; AI output is assistance, not independent authority.

## D. Customer / Lead lifecycle

The current model supports individual and company customers, confirmed or placeholder names, contact identifiers, source/source remarks, requested business projects, profile fields and follow-up history. Entry method is distinct from customer acquisition source. Historical inactive source values can remain on existing records without becoming valid new-entry choices.

Customer status is `active`, `inactive`, `archived` or `public_pool`. Current sales stages are `new_lead`, `contacted`, `interested`, `proposal`, `negotiation`, `closed_won`, `closed_lost`, `on_hold` and `paid`; legacy stage values still have compatibility handling. These are not a guarantee that every transition is freely selectable.

`paid` is approval-only, including for Admin direct edits. `closed_won` uses Team Member approval or a permitted Admin update; it is not a direct-create/import stage. Post-payment lifecycle completion has paid-state prerequisites and its own completion metadata. This distinction follows [stage constants](../src/lib/constants/customer-fields.ts), rather than treating all terminal stages as identical.

### Follow-up product / implementation drift

| Evidence dimension | Recorded rule |
| --- | --- |
| **OWNER PRODUCT BASELINE** | Follow-up content: **minimum 5 characters**. Next action: **minimum 5 characters**. |
| **CURRENT IMPLEMENTATION OBSERVED** | Follow-up summary: minimum 5 characters; next action: **minimum 10 characters**; next follow-up: **at least 45 minutes in the future**, confirmed in current validation source. |
| **STATUS** | **PRODUCT / IMPLEMENTATION DRIFT — HUMAN DECISION REQUIRED**. |

There is insufficient human decision evidence that the owner deliberately replaced the historical 5-character next-action baseline with 10 characters or approved the 45-minute scheduling minimum as product policy. The content/summary 5-character threshold aligns; next-action length and scheduling policy need an explicit decision. Do not change code, automatically treat the observed values as approved policy, or assume a different scheduling minimum. See [P1-07](CRM_IMPLEMENTATION_PLAN.md#p1-07--follow-up-product--implementation-drift).

First-contact gates and valid-follow-up rules affect subsequent work. Customer heat/completeness scores are deterministic calculations, separate from AI insights.

Family/household relationships and associated approval workflows exist. Soft deletion, recycle-bin restoration and purge paths exist; a successful soft-delete action is not proof of disaster recovery. Current recycle retention policy is 90 days in code. Admin import/export paths exist with precheck/job guards; they are not Team Member bulk-access permissions. Contact entities exist, but a general standalone Contacts CRUD product is not established.

Evidence: [customer schema](../drizzle/schema/customers.ts), [customer services](../src/lib/customers), [follow-up validation](../src/lib/follow-ups/validation.ts), [recycle bin](../src/lib/recycle-bin), [import/export permissions](../src/lib/permissions).

## E. Customer ownership and collaborators

Primary ownership and the primary assignee must remain synchronized across claim, transfer and reclamation. Collaborators may see permitted details and add follow-ups; collaboration does not make them primary owners or grant general customer editing.

Team Member owners may edit permitted fields, but sensitive customer identity/contact/business fields remain locked after creation. Admin has broader editing authority, subject to workflow and archived-state guards. Owner/Admin collaborator management and the separate collaborator-removal approval flow must not be confused with the deprecated assignee-update approval endpoint.

Unrelated Team Member cannot read private customer details. Archived customers expose only limited basic information to related Team Member; Admin access is broader, while archived writes remain restricted.

**HUMAN-CONFIRMED PRODUCT RULE — collaboration lifetime:** Default collaboration is long-term. A collaborator / 协作成员 must not be automatically removed solely because that individual did not personally write follow-ups. The primary Team Member may perform operational follow-ups while another collaborator continues providing guidance. Automatic removal is valid only when a specifically approved temporary-expiry / auto-remove rule was explicitly selected. Customer inactivity/reclamation must assess the customer/relationship workflow, not infer individual collaborator inactivity as removal authority.

**Implementation distinction:** Current [collaboration detection](../src/lib/reclamation/collaborative.ts) exempts collaborative customers from ordinary reclaim/warnings; the audited collaborative path provides reminders/dry-run behavior. End-to-end enforcement of the full lifetime rule and any explicitly selected temporary-expiry exception is **IMPLEMENTATION VERIFICATION REQUIRED**. Historical future-dissolution comments do not approve automatic individual removal.

## F. Public Pool behavior

Team Member claim randomly. Team Member cannot select a customer ID to bypass random selection, even if a desktop list exposes a masked row. Eligibility, quota, cooldown, self-release exclusions and ownership changes are enforced server-side.

The current random selection considers up to the oldest 10 eligible candidates. The seven-day quota and cooldown have defaults of 5 and 12 hours, with effective settings/member overrides. These are code defaults, not a newly queried Production setting. Team Member cannot reclaim their own recently released customer within seven days. Member policy includes a 45-day first-login protection period, legacy-account compatibility and Admin pause/overrides.

**HUMAN-CONFIRMED PRODUCT RULE — per-member controls:** Public Pool eligibility must be independently controllable per Team Member. New Team Members default to claiming **DISABLED**. Admin controls enabled/disabled state, claim quota and cooldown per member; member-specific policy overrides global defaults where designed. When disabled, the member-facing state communicates **暂无可领取客户资源**, or its approved localized equivalent. Disabling claiming must not automatically remove/reclaim customers already owned by that Team Member.

**Implementation distinction:** Admin pause/unpause and per-member quota/cooldown overrides are **IMPLEMENTED IN SOURCE**, via the [policy route](../src/app/api/admin/users/[id]/public-pool-policy/route.ts) and [member policy](../src/lib/public-pool/member-policy.ts). That route updates user policy without reclaiming owned customers. The schema's `poolClaimPaused` default is `0`, and a 45-day protection period is not the same as the confirmed default-disabled policy. Full new-member default-disabled semantics, disabled-state copy and end-to-end preservation of owned customers remain **HUMAN-CONFIRMED PRODUCT RULE / IMPLEMENTATION VERIFICATION REQUIRED**; no runtime pass is claimed.

Desktop Team Member can load a masked list; Team Member server rendering supplies no customer list, and mobile Team Member use random-claim controls, summaries and quick entry without a browseable pool list. Admin has fuller pool visibility and ID-based operations under Admin authorization. Claiming must not reveal private pre-claim contact details or follow-up content.

Release and automatic reclamation return eligible customers to the pool through dedicated paths. Reclamation uses inactivity rules, warnings, exclusions and concurrency guards. Collaborative customers have a separate reminder path rather than ordinary automatic reclamation. Default reclaim duration is not proof of the effective live setting.

**HUMAN-CONFIRMED PRODUCT RULE — release/reclaim history:** Preserve explicit release confirmation and release reason/history. Automatic reclaim/audit data must retain the previous owner, so Admin reason/history can identify the original responsible Team Member. Ordinary Team Members must not receive private pre-claim information. Current [release service](../src/lib/public-pool/service.ts) stores reason and previous owner in state/audit, and the [reclaim engine](../src/lib/reclamation/engine.ts) carries previous-owner metadata: **IMPLEMENTED IN SOURCE** for those persistence paths. Complete release-confirmation UX and Admin-facing owner/reason presentation are **IMPLEMENTATION VERIFICATION REQUIRED**, not a claimed Production smoke result.

Evidence: [Public Pool services](../src/lib/public-pool), [member policy](../src/lib/public-pool/member-policy.ts), [reclamation](../src/lib/reclamation), [Public Pool UI](../src/app/(dashboard)/public-pool).

## G. Approval Center

Customer workflows include deletion, transfer, closed-won, second conversion, on-hold creation, collaborator removal, paid status, family link/update/unlink and priority set/unset. Requests have actor/customer scope, pending-state checks, results and notification/history behavior. Request visibility and authority to approve are different capabilities.

**Customer Merge is currently DISABLED.** A schema value, switch branch or old proposal does not enable it. The legacy `update_customer_assignees` approval request path is deprecated and returns a gone response; use the current ownership/collaboration flows. Mail approval and Knowledge review are distinct workflows, not interchangeable Customer Approval Center types.

Evidence: [approval services](../src/lib/approvals), [approval permissions](../src/lib/permissions/approvals.ts), [merge-disabled regression](../src/lib/approvals/service-merge-disabled.test.ts).

## H. Team Member / Admin

Active/disabled/deleted user states, login/device controls, Team Member statistics, permissioned user management and transfer-on-deletion behavior exist. Last-active-Admin safeguards protect administration continuity. Admin deletion is restricted; Team Member deletion requires ownership handling and consistent assignees.

Team Member activation, password change and device approval are separate steps. Admin exceptions to Team Member lockout/device gates do not mean exemption from every authentication or authorization rule. CRM administration, Knowledge administration and Mail delegated administration remain separate systems.

The intended **Cloudflare Access session duration is 1 week — OWNER-CONFIRMED POLICY / LIVE CONFIG NOT VERIFIED IN TAKEOVER**. **CRM inactivity logout is 30 minutes** as the owner baseline and current code default, with existing configurable/exemption behavior documented separately. The repository also implements a **seven-day CRM absolute session ceiling**. Access session duration, CRM absolute lifetime and CRM idle timeout are three distinct controls; matching durations do not make them one rule. 0D did not audit live Access policy.

## I. Dashboard / Reports

Dashboards and reports derive metrics from real, permission-scoped CRM records. Admin/team and Team Member scopes differ. Hong Kong calendar semantics, trend windows, stage distributions, drilldowns and zero-filled time series exist. Tasks and notifications supply work items.

**Owner-confirmed default product presentation:** Dashboard curve/trend defaults to **7 days**. The **7 / 30 / 90 day** ranges may remain available where implemented. This records the desired default, not a fresh Production runtime verification.

AI management briefs and Team Member action suggestions use scoped inputs; deterministic fallback is identified as a system fallback. It must not be represented as successful AI output. No Production business values or end-to-end report correctness were queried during takeover documentation.

Evidence: [report services](../src/lib/reports), [dashboard AI](../src/lib/ai/dashboard-insights).

## J. Mail Center

**Status: PARTIAL / HYBRID.** Real backend workflows coexist with a prototype-derived shell and incomplete UI features. Production builds select the real read source; non-production modes can show fixtures. A visible prototype interaction is not proof of durable backend behavior.

Implemented capabilities include provisioned mailbox access, recipient visibility including Bcc restrictions, drafts, immutable outbound revisions, Team Member review/return/withdraw/resubmit, authorized Admin direct send, send operations, inbound staging/materialization, delivery events, signatures and normal/large attachments. Accepted transport, a Sent record and recipient delivery are different states. A sender identity is not a mailbox membership.

Team Member outbound content is reviewed as an immutable revision. Editing requires the appropriate new revision/review workflow. Reviewers cannot approve their own Team Member submission. Admin direct send still requires provisioned Mail access and sender-identity authorization; global reading is not send-as authority.

Shared processing/internal notes/templates retain prototype dependencies; some personal settings are placeholders. Own-message read/unread state exists, but external open/click tracking is not implemented. `auto_reply` grant/prototype concepts do not establish a working auto-reply workflow. Mail read audit has a hook without durable persistence.

**Owner-confirmed Mail product direction (separate from current implementation status):**

- Independently controlled Mail access/mailbox workflow for each Team Member; Mailbox and sender identity remain distinct, and one Mailbox may support multiple approved sender identities.
- From selection and arbitrary To / Cc / Bcc recipients subject to validation/security; Team Member outbound approval and authorized Admin direct-send.
- Rich-text compose and fixed signature capability; signature content may include text/images with user-managed layout. Existing signature primitives do not prove every intended layout control is implemented.
- Large attachment target up to approximately **100 MB per file**, subject to implemented policy/technical limits (current large-file code uses 100 MiB).
- External **read receipt** capability: **CONFIRMED FUTURE PRODUCT DIRECTION — NOT IMPLEMENTED / NOT RELEASE APPROVED**. This is distinct from internal mailbox read/unread state.
- **Automatic reply:** desired **LATER** direction; **CONFIRMED FUTURE PRODUCT DIRECTION — NOT IMPLEMENTED / NOT RELEASE APPROVED**.

External click tracking remains **NOT APPROVED / HUMAN DECISION REQUIRED**. Confirming read receipts does not approve click tracking, a particular tracking mechanism, implementation work, privacy policy or release. Other directions above include implemented primitives and incomplete UI; their confirmation does not promote Mail beyond **PARTIAL / HYBRID**.

Normal attachments and large attachments have separate storage, upload/delivery limits and expiry policies. Large files use time-limited bearer download links; possession of a valid link is the recipient authorization boundary, not recipient OTP. See [security](CRM_SECURITY_AND_PERMISSIONS.md) and [architecture](CRM_ARCHITECTURE.md) for precise boundaries.

Evidence: [Mail page](../src/app/(dashboard)/mail/page.tsx), [read-source selection](../src/lib/mail/client/mail-read-source.ts), [Mail services](../src/lib/mail), [read audit hook](../src/lib/mail/message-read-permissions.ts).

## K. Knowledge

Knowledge requires a CRM session, secondary unlock and appropriate Knowledge role. Categories organize Knowledge; customer requested-business taxonomy is a different classification system.

Articles have draft/version/review/publication states and visibility scopes. Published retrieval uses permitted publication snapshots, not arbitrary drafts, raw sources, Mail or customer tables. This separation does not automatically detect private information pasted by a human.

Sources support pasted text, text/Markdown, DOCX, text-layer PDF and supported JPEG/PNG images through vision extraction. Scanned-PDF OCR is **not supported**. Extraction failures or unusable evidence must remain visible; they are not replaced with invented content. Duplicate detection uses source identity/content rules, not semantic equivalence of all documents.

Organizer output targets Simplified Chinese canonical article title/summary/body while preserving supported facts and proper names. AI organization and comparison use source evidence and visible published candidates. Validation/grounding checks reduce unsupported output; they do not prove every generated statement. Reviewers must check conditions, numbers, deadlines, qualifications and uncertainty.

Original source files are retained separately. Explicit human extraction confirmation may replace extracted raw text with reviewed evidence and records that action; this is not a complete raw-text revision-history guarantee. Archive/restore of a source is not equivalent to deleting/restoring its R2 object.

## L. Smart Ingest

Smart Ingest 1 provides analysis runs, evidence segments, confirmation/rejection and business-identity metadata. Production migration metadata is verified through 0086. This does not independently certify every UI behavior on the deployed Worker.

Smart Ingest 2 at this branch is **IMPLEMENTED / HUMAN ACCEPTED / ENGINEERING CLOSEOUT ACCEPTED / NOT PRODUCTION DEPLOYED**. Migrations 0087–0090 and the Production Release Audit are **PENDING**.

Each confirmed segment can materialize its own persistent candidate. Business identity and Knowledge Category can be reviewed independently. Priority is human override, then explicit business-category mapping, then eligible AI suggestion; medium/low confidence requires appropriate human handling rather than silent classification.

Each candidate organizes and compares its own segment evidence, preserves lineage and can create/open its own draft article. One Source can therefore create multiple Candidate Articles. Reorganization retains an existing draft link and does not silently overwrite the article. Changed organizer content invalidates a stale comparison before conversion.

Sequential repeat conversion can return the existing article. Concurrent conversion/partial-write safety remains a documented risk, not a proven guarantee. See [P1-01](CRM_IMPLEMENTATION_PLAN.md#p1-01--candidate-conversion-concurrency).

## M. Mobile behavior

Responsive customer/work-item views, mobile navigation and PWA/install/resume support exist. Team Member Public Pool intentionally differs from desktop: no pool browsing list, but random claim and quick entry remain. Candidate Open Draft uses a real article link suitable for native mobile navigation.

Historical Safari/resume acceptance is dated evidence. It does not certify every current route/device, Mail feature or new branch. Scope any new mobile acceptance to named flows, browser/device and SHA.

## N. Human-review principles

Human Acceptance, engineering closeout, tests and Production release approval are separate records. The owner-confirmed Smart Ingest 2 acceptance must not be silently revoked by this documentation gate; release risk resolution still needs a concrete decision.

Reviewers should see original evidence, extracted usability, AI uncertainties, classification overrides, comparison freshness and draft lineage where relevant. Unsupported evidence must not be invented to make a workflow appear successful. Unknown historical rationale is not a basis to redesign accepted behavior.

## O. Explicitly unsupported / disabled capabilities

| Capability | Current position |
| --- | --- |
| Customer Merge | DISABLED; implementation/re-enablement requires human approval. |
| Scanned PDF OCR | Unsupported; image vision support does not imply PDF OCR. |
| Mail auto-reply | CONFIRMED FUTURE PRODUCT DIRECTION — NOT IMPLEMENTED / NOT RELEASE APPROVED; LATER. |
| External Mail read receipt | CONFIRMED FUTURE PRODUCT DIRECTION — NOT IMPLEMENTED / NOT RELEASE APPROVED; distinct from internal read state. |
| External Mail click tracking | NOT IMPLEMENTED; NOT APPROVED / HUMAN DECISION REQUIRED. |
| General customer attachments / standalone Contacts CRUD | Full product capability not established. |
| Complete Mail settings/templates/shared-processing UX | PARTIAL / HYBRID; do not promise completion. |
| Full-system proven restore | Not established by current backups or takeover audit. |
| Smart Ingest 2 in Production | NO; release approval, migrations and deployment remain pending. |

Unconfirmed future capabilities remain `HISTORICAL PROPOSAL — NOT CURRENTLY APPROVED` or `HUMAN DECISION REQUIRED`. The owner-confirmed Mail directions above are distinct from those unconfirmed proposals; implementation and release approval remain separate and have not been granted.

## P. Product invariants

Preserve Team Member random claim and pre-claim privacy; separate Access/session/unlock; separate business and Knowledge taxonomies; preserve human override priority, source evidence and segment isolation; allow multiple Candidate Articles per Source; separate Mail read/send-as and immutable Team Member approval; separate normal/large file lifecycles; keep Production Mock AI off; never equate backups with demonstrated recovery.

Use **团队成员 / 團隊成員 / Team Member** in product/UI terminology, retaining internal `staff` identifiers. Preserve per-member claim controls/default-disabled intent, long-term collaboration without individual-inactivity removal, and release/reclaim history with Admin-only previous-owner context. Implementation gaps and the follow-up 5 versus 10/45 discrepancy remain explicit; they are not silently resolved by an invariant statement.

## Q. Open Human Decisions

1. Final review of the 0F-B corrections is APPROVED — 2026-09-26; clarify any still-missing historical acceptance scope, which remains open.
2. Decide Smart Ingest 2 release timing and resolution/acceptance of conversion concurrency risk. Acceptance of the feature is not release authorization.
3. Set recovery scope, retention, recovery-time and recovery-point objectives; approve an isolated restore rehearsal and large-file cleanup policy/verification scope.
4. Prioritize remaining Mail hybrid features and decide required read-audit coverage/retention; scope implementation/privacy/release gates for confirmed read receipts and LATER auto-reply. Their product direction is already confirmed.
5. Review reported public GitHub exposure and decide repository visibility after integration/collaborator impact review.
6. Decide whether Customer Merge re-enablement, scanned PDF OCR, customer attachments, external click tracking or other unconfirmed historical capabilities are wanted. None is approved by this document.
7. Confirm unknown historical business rationale recorded in [decisions](CRM_DECISIONS.md).
8. Resolve follow-up **PRODUCT / IMPLEMENTATION DRIFT — HUMAN DECISION REQUIRED**: owner baseline is 5 characters for content and next action; current next-action/scheduling rules are 10 characters/45 minutes. No code correction or replacement product policy is authorized here.
9. Authorize separately scoped verification/remediation for confirmed Public Pool default-disabled/copy, collaboration lifetime and release/reclaim presentation rules where evidence remains incomplete; do not treat these already-confirmed directions as undecided product intent.

All decisions above are **HUMAN DECISION REQUIRED**. The [implementation plan](CRM_IMPLEMENTATION_PLAN.md) is a review queue, not permission to implement. Historical-document labels are indexed in [module status](CRM_MODULE_STATUS.md#historical-document-index).
