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

# ECHFRONT CRM — security and permissions

Current documentation corrected in 0F-B after Chat/Human review (2026-09-26). Open decisions remain documented. This is a map of current authorization behavior and known limits, not a penetration-test certification or permission to change policies. Source code is authoritative over old permission plans. Production Access policy, DNS and business content were not queried by this documentation gate.

**Team Member (internal role: `staff`)** is the product term used below; preferred UI labels are 团队成员 / 團隊成員 / Team Member. Internal identifiers remain unchanged. Owner-confirmed intended rules are recorded separately from observed authorization code; an implementation gap is not permission to change either policy or code.

## Distinct identity and access layers

| Layer | What it establishes | What it does not establish |
| --- | --- | --- |
| Cloudflare Access | Verified gateway identity/token according to configured issuer/audience/time checks | A valid CRM account/session, Knowledge unlock, Mail sender grant or customer scope. |
| CRM login/session | Active CRM actor and allowed session/device/activation state | Unlimited domain permissions or an unlocked Knowledge session. |
| Customer authorization | Record/action visibility and allowed transitions | General Mail or Knowledge access. |
| Knowledge secondary access | Session/password-version-bound unlock plus Knowledge role | Ownership of every source or visibility of every article. |
| Mail effective access, membership and grants | Permitted workspace/read/control/approval actions | Automatic send-as permission for all identities. |
| Large-file recipient token | Time-limited authority to download its specific file | CRM login, verified recipient identity or general bucket access. |

### Cloudflare Access

[Access JWT validation](../src/lib/auth/access-jwt.ts) verifies signature and claims including issuer, audience and validity times. Login policy also considers the Access verification window. Any local bypass must be explicitly non-Production; a Host header is not sufficient authorization to skip Access.

The current Team Member Access-email mapping is separate from ordinary CRM login identity. Binding happens only after credential validation, observes uniqueness/legacy compatibility and must not silently overwrite another mapping. Admin's configured super-admin Access exception has different handling. See [Team Member Access email binding](../src/lib/auth/staff-access-email-binding.ts).

0D verified account identity and relevant binding/secret names, not the full live Access application or OTP policy. Do not document an assumed OTP duration/provider policy as verified. Access changes require explicit human scope.

**Cloudflare Access intended session duration: 1 week — OWNER-CONFIRMED POLICY / LIVE CONFIG NOT VERIFIED IN TAKEOVER.** This was confirmed by the owner in 0F-B; 0D did not verify the live Access duration. It is separate from both the CRM absolute session lifetime and CRM idle timeout.

### CRM login, sessions and idle logout

[Sessions](../src/lib/auth/session.ts) use an opaque random cookie token with hashed server-side storage, not a CRM JWT bearer containing all permissions. Cookie handling includes HttpOnly, SameSite Lax and secure Production behavior. The absolute session ceiling is seven days; idle expiry can revoke earlier. A new successful login revokes previous active CRM sessions for that user.

The default idle timeout is 30 minutes, configurable within 5–1440 minutes. Global/session idle-exemption mechanisms and re-verification transitions exist; these are deliberate policy controls, not absence of idle security. The client timer displays/reacts to state, while server policy enforces validity. Background badge polling should not be assumed to constitute user activity. See [session policy](../src/lib/auth/session-policy.ts), [idle configuration](../src/lib/settings/idle-timeout.ts), [session/Access separation tests](../src/lib/auth/session-access-separation.integration.test.ts).

| Control | Policy/evidence | Live verification |
| --- | --- | --- |
| Cloudflare Access session | **1 week**, owner-confirmed intended Access policy | **LIVE CONFIG NOT VERIFIED IN TAKEOVER**. |
| CRM absolute session lifetime | **7 days**, observed repository ceiling | Source observation, not a statement about Access settings. |
| CRM inactivity logout | **30 minutes**, owner-confirmed baseline and source default; existing configurable/exemption behavior remains | Effective live setting/exemptions not queried. |

Do not combine these controls into a single seven-day session rule or infer that a valid Access session cancels CRM idle expiry.

Team Member lockout occurs after three failed password attempts and persists until authorized unlock. Admin exceptions are explicit in [lockout policy](../src/lib/auth/lockout.ts). Team Member activation can require a password change before general access. Device approval/rejection/revocation/replacement is enforced for Team Member; Admin devices are tracked with different blocking behavior. Revoking a device can revoke associated sessions. Local auth simulation is an explicitly scoped development facility, not a Production recovery route.

## Client visibility versus server authorization

UI filters, hidden actions and responsive rendering improve presentation. They do not grant or deny authority on their own. Every data-returning route and mutation must apply the relevant server session, role, object scope and workflow checks. Avoid returning sensitive data and relying on CSS/client filtering to hide it.

Team Member Public Pool is a concrete example: empty Team Member SSR payload, masked desktop rows and mobile omission reduce exposure, but the server also blocks direct ID claim and private pre-claim details. Conversely, a visible customer row does not mean all edits, follow-ups, approvals or exports are permitted.

## CRM authorization matrix

Unless stated otherwise, all actors require an active valid CRM session. Archived/deleted and workflow-specific guards apply in addition to this summary.

| Action | Team Member primary owner | Team Member collaborator/assignee | Unrelated Team Member | CRM Admin | Server authority |
| --- | --- | --- | --- | --- | --- |
| Read active private customer details | YES | YES when resolved as assigned | NO | YES | Customer access scope and assignee resolution. |
| Read archived customer | Basic non-sensitive view | Basic if related | NO | Broader read | Archived-state scope; not ordinary editing permission. |
| Edit customer master record | Permitted fields only; sensitive fields locked | NO solely from collaboration | NO | YES subject to workflow/state guards | Ownership plus sensitive-field/status checks. |
| Add follow-up | YES if allowed state | YES if assigned/allowed state | NO | YES if allowed state | Full-access and follow-up validation. |
| Submit ordinary customer approval | Owner and permitted state/type | NO solely from collaboration | NO | Per active type | Owner/record/type checks; some creation/family workflows have additional rules. |
| Review customer approvals | NO | NO | NO | YES under service rules | Admin approval path, request state and action validation. |
| Manage collaborator membership | Owner scope; removal workflow may require approval | NO solely from collaboration | NO | YES | Dedicated collaboration services; never implicit ownership transfer. |
| Claim Public Pool customer | Random and eligible | Random and eligible | Random and eligible | ID-based/Admin path allowed | Team Member ID-claim denial, quota/cooldown/member policy and atomic state change. |
| Read unclaimed pool private details | NO | NO | NO | YES | Team Member masking/detail guards; knowledge of ID is insufficient. |
| Set `paid` by general edit | NO | NO | NO | NO | Dedicated approval-only transition for all roles. |
| Bulk import/export or Team Member administration | NO | NO | NO | YES under dedicated guards | Admin-only domain permissions. |
| Merge customers | DISABLED | DISABLED | DISABLED | DISABLED | Both request/approval service reject merge. |

Evidence: [customer permissions](../src/lib/permissions/customers.ts), [approval permissions](../src/lib/permissions/approvals.ts), [approval services](../src/lib/approvals), [import](../src/lib/permissions/import.ts), [export](../src/lib/permissions/export.ts), [user management](../src/lib/permissions/user-management.ts).

Primary owner and primary assignee synchronization is a data integrity boundary. Team Member-sensitive fields include customer identity, contact and requested-business information; being able to view them does not permit editing them. Public-pool status must use the release flow, not an ordinary status PATCH. Archived writes remain blocked even where Admin can read.

## Public Pool privacy and eligibility

The Team Member list is a deliberately restricted projection, excluding private contact/follow-up payloads. Team Member direct ID claim is rejected before loading the target customer. Detail/AI-insight/follow-up endpoints need their own authorization; an unrelated route must not bypass the pool boundary.

Random claiming applies effective quota/cooldown, recent self-release exclusion, first-login protection and Admin pause. Client-provided candidate ordering or eligibility cannot override server decisions. Administrative visibility is separate from Team Member claimant visibility. Evidence: [random claim service](../src/lib/public-pool/random-claim-service.ts), [pool detail tests](../src/lib/permissions/public-pool-detail-api.test.ts), [ID-claim tests](../src/app/api/public-pool/customers/id-claim-route.test.ts).

**HUMAN-CONFIRMED PRODUCT RULE:** claiming controls are independent per Team Member; new members default to claiming DISABLED. Admin controls enabled/disabled, quota and cooldown, with designed per-member overrides taking precedence. Disabled member-facing copy must say **暂无可领取客户资源** or its approved localized equivalent; it must not expose private pool details. Disabling claiming must not remove/reclaim already-owned customers.

The [Admin policy route](../src/app/api/admin/users/[id]/public-pool-policy/route.ts) implements pause/unpause and quota/cooldown updates without customer mutation. Complete default-disabled and UI-copy compliance is **IMPLEMENTATION VERIFICATION REQUIRED**: the schema defaults pause to `0`, and the separate 45-day protection is not equivalent to explicit default-disabled policy. This document does not assert a fresh Production policy test.

### Collaboration and release/reclaim authorization

**HUMAN-CONFIRMED PRODUCT RULE:** collaboration is long-term by default. An individual collaborator must not be removed solely for not writing personal follow-ups; a primary Team Member can perform operational follow-ups while another provides guidance. Automatic removal requires an explicitly selected, specifically approved temporary-expiry/auto-remove rule. Evaluate inactivity at the customer/relationship workflow boundary; individual silence is not removal authority.

Current [collaborative customer detection](../src/lib/reclamation/collaborative.ts) excludes collaborative customers from ordinary auto-reclaim/warnings. Full lifetime/exception enforcement is **IMPLEMENTATION VERIFICATION REQUIRED**. Historical future-dissolution notes do not approve an individual auto-removal policy.

Release requires explicit confirmation plus reason/history as the confirmed product rule. [Release](../src/lib/public-pool/service.ts) and [automatic reclaim](../src/lib/reclamation/engine.ts) retain previous-owner metadata in state/audit: those persistence paths are implemented in source. Admin history should identify the original responsible Team Member. Complete confirmation/history UI is **IMPLEMENTATION VERIFICATION REQUIRED**. Admin visibility must never become ordinary Team Member pre-claim private-data visibility.

## Knowledge secondary access and roles

All ordinary Knowledge actions require the CRM session and secondary unlock. Unlock is tied to session and password version; a prior CRM login alone does not establish it. Policy bootstrap and last-admin protections have explicit handling. Do not turn CRM Admin into universal implicit Knowledge content access.

| Capability after secondary unlock | Viewer | Contributor | Reviewer | Knowledge Admin |
| --- | --- | --- | --- | --- |
| Read visible published snapshots | YES | YES | YES | YES, within service rules |
| Author/edit articles | NO | YES for permitted draft/visibility scope | **NO solely from reviewer role** | YES, subject to state/review guards |
| Ingest/manage sources | NO | Own manageable sources | NO solely from reviewer role | Permitted sources across users |
| Submit article for review | NO | YES for permitted article | NO solely from reviewer role | YES for permitted article |
| Review/publish | NO | Not reviewer authority | YES within assigned/workflow scope | YES within workflow scope |
| Manage categories, mappings, roles and policy | NO | NO | NO | YES, subject to lifecycle/last-admin rules |
| Create restricted article visibility | NO | NO | NO | YES |

The generic role rank helper is not a complete capability hierarchy: action-specific helpers deliberately restrict authoring to contributor or Knowledge Admin. Contributors can edit permitted team drafts as allowed by the article service; they are not necessarily limited to only their own articles. Owner-only/restricted/publication/archived/pending-review rules still apply.

Evidence: [Knowledge permission entry](../src/lib/permissions/knowledge.ts), [article permissions](../src/lib/knowledge/article-permissions.ts), [source service](../src/lib/knowledge/source-service.ts), [unlock service](../src/lib/knowledge/unlock-service.ts), [review service](../src/lib/knowledge/review-service.ts).

### Evidence and AI boundaries

Published retrieval must enforce the requesting actor's visibility and use published snapshots. Customer, Team Member, Mail and raw-source tables are not a general Knowledge retrieval corpus. This boundary does not remove sensitive text that a human intentionally or accidentally pastes into an authorized source.

AI suggestions never supersede an explicit human category/business override. Candidate evidence stays within the confirmed segment, with source offsets/lineage preserved. A human can explicitly confirm/correct extraction; that does not authorize silent AI rewriting of raw evidence. Original files are separate from extracted text, and full text revision history is not established.

Only permitted published comparison candidates are exposed. Stale organizer comparison blocks conversion. Grounding/fact checks do not make unsupported generation impossible; human evidence review remains required. Production Mock AI stays off. Smart Ingest 2 candidate/mapping permissions exist in feature code but its Production migrations/deployment remain pending.

### 1B-A candidate mutation correction — 2026-09-26

1A confirmed a P0 defect: candidate PATCH called ID-only update helpers before source/manage/lifecycle authorization. The authorized 1B-A local remediation moves the action into a service that checks source authority and current confirmed lineage, validates all business/category fields, and commits one conditional update. Session and Knowledge unlock remain enforced by `requireKnowledgeAccess` in the HTTP route. CRM Admin still does not automatically become Knowledge Admin.

Viewer, reviewer, non-owner contributor, wrong-source, superseded/old-lineage, archived, unconfirmed and invalid-input requests must produce zero candidate writes. The HTTP adapter returns the committed snapshot after success; a later unrelated state change must not turn that successful PATCH into a post-write denial. Candidate manual mutation is blocked after conversion.

Automatic business/category writes must match the captured candidate revision and manual-override state at commit. They cannot reset a newer human override. Category activity and explicit mapping priority are checked in committing SQL; unresolved/medium/low/error results cannot silently retain an older automatic category. Candidate organization/comparison/conversion also enforce current lineage at commit. See [1B-A local test evidence](CRM_MODULE_STATUS.md#1b-a-local-remediation-evidence).

These are local source corrections, pending Chat review and full validation. They are not Production verification or release authorization.

**1B-A3 closure — 2026-09-26:** The owner confirms that an intentionally blank category is a human override. Manual category writes, including null, set the flag true; only the explicit Candidate PATCH reset action sets it false. Reset uses the same authorization/current-lineage/revision guards and cannot be combined with a manual category value in one request. Automatic writes must preserve committed manual state, including blank. PATCH tests assert zero candidate business-data mutation; normal authentication session touch/revocation or denied-access audit may still write outside this candidate service. Direct proposed-segment and failed-source PATCH cases complete the earlier test gaps. No Production change or verification is claimed.

## Mail authorization matrix

Mail distinguishes effective workspace access, persisted provisioning, mailbox read, control-plane grants, approval review and sender identity permission.

| Capability | Ordinary Team Member | Delegated Mail administrator / reviewer | CRM root Admin |
| --- | --- | --- | --- |
| Enter/read Mail workspace | Enabled persisted Mail access plus object scope | Requires effective access; admin grant alone is insufficient | Effective access derived from CRM Admin role |
| Read active mailbox/messages | Personal owner or valid `can_read` membership | Same, or explicit global-read authority with access | Effective global supervision read; no membership prerequisite |
| Administer Mail accounts/addresses/grants | Only explicitly granted actions | Granular control-plane grants; Mail `super_admin` implies those grants | Full Mail control plane |
| Compose/submit/send as identity | Enabled persisted Mail access plus live compose/sender grants | Same; delegation does not grant send-as automatically | **Same provisioning/sender requirements** despite global read |
| Review Team Member outbound mail | Only if separately granted review authority | Effective access plus `approval_review`/Mail `super_admin`; no self-review | Review authority; no self-review of Team Member submission |
| Use `admin_direct` send | NO | NO unless also CRM Admin | YES only with persisted Mail access and sender authorization |
| Manage signatures/delivery health | Only if explicitly granted | Relevant granular grant | Control-plane authority |

Mailbox ownership is not equivalent to sender identity ownership or permission. Provisioning a personal mailbox for an active CRM account does not itself enable Mail or authorize sending. Global supervision visibility and Bcc visibility remain read capabilities.

[Mailbox/message read authorization](../src/lib/mail/message-read-permissions.ts) restricts inactive mailboxes, checks membership/personal ownership/global-read authority and maps inaccessible message objects to appropriate non-enumerating responses. To/Cc remain visible to allowed viewers; Bcc has additional author/owner/processing/global-read rules. Disabling Mail access is distinct from hiding an individual message.

[Mail permissions](../src/lib/permissions/mail.ts), [outbound dispatch permissions](../src/lib/mail/outbound-sending-permissions.ts) and [approval service](../src/lib/mail/outbound-approval-service.ts) govern separate planes. Team Member submission freezes a revision. Return/withdraw/resubmit creates the appropriate review transition; reviewers cannot approve their own request. Admin direct send does not bypass content/file/identity validation. Background system actors dispatch only through operational workflows; the system actor is not an ordinary client-selected role.

The read-audit function currently performs no durable write. Do not tell auditors that every mailbox/message/attachment read is persisted. Internal read/unread state is different from audit logging and different again from external open/click tracking. Mail remains **PARTIAL / HYBRID**.

External read receipts and LATER auto-reply are owner-confirmed future product direction, **NOT IMPLEMENTED / NOT RELEASE APPROVED**. Confirmation does not grant implementation/transport authorization or approve a tracking mechanism. External click tracking remains **NOT APPROVED / HUMAN DECISION REQUIRED**; it is not implied by read receipts.

## R2 and private-file boundaries

Normal Mail downloads go through authenticated message/draft/revision access checks; file ID knowledge is not permission. R2 objects are not intended as public buckets. Source-file access must use Knowledge source authorization, not an unrestricted object key.

Large files use dedicated storage and lifecycle metadata. Server-authorized signed uploads constrain object key, content headers and conditional creation; finalize checks known size/object identity. Signed Content-MD5 provides the implemented upload checksum contract. A claimed SHA-256 and R2 ETag must not be represented as independent server SHA-256 verification.

Recipient download links are bearer credentials: a valid token can be forwarded. The gateway uses secret-authenticated CRM service authorization and private R2 streaming, with expiry/revocation controls. It does not validate a recipient's email via OTP and has no direct D1 binding. Token expiry does not prove that the underlying R2 bytes were deleted. Full periodic large-object cleanup verification is an open operational item.

No token, signed URL, cookie, private key, connection credential, secret value, customer content or raw Mail content belongs in these docs or release reports. Store/transfer necessary credentials only through approved private mechanisms; named secret bindings are not their values.

## Public GitHub exposure and repository security

The takeover recorded the repository as **PUBLIC**. That classification is carried forward from 0A/0E, not newly queried from GitHub in 0F-A. Public application source exposes architecture, operational resource identifiers, authorization design and business rules even if no credential is present. `package.json` declaring `private: true` prevents npm publication; it does not make GitHub private.

0E's limited current-file pattern checks did not find the selected common credential signatures. That is **not a full Git-history secret audit or a guarantee of no exposure**. This gate did not inspect credential files or claim a complete leak audit.

Reviewing visibility/integration dependencies and private secret scanning is an evidence-backed security follow-up. Whether to make the repository private is **HUMAN DECISION REQUIRED**. No visibility change, collaborator change, token rotation or history rewrite is authorized by this document. Public GitHub exposure is tracked as [P1-05](CRM_IMPLEMENTATION_PLAN.md#p1-05--public-github-exposure-review).

## Operational authorization boundaries

Production data queries beyond approved metadata, migrations, deploy/rollback, secrets, Access/DNS, R2 mutation and mail side effects require explicit target/action approval. A previous one-query authorization is not an evergreen permission. Preview tests using real shared AI or external mail are not side-effect-free simply because they run on a Preview hostname.

Read CLI source/behavior where necessary: the installed Wrangler `d1 migrations list` can initialize the tracking table and therefore is unsuitable for a strict read-only audit. Expired OAuth may trigger refresh writes; human credential restoration must follow the authorized scope without exposing credential values. Use the [deployment runbook](CRM_DEPLOYMENT_RUNBOOK.md) for review gates, not old phase shortcuts.

Backup files, local databases, WAL sidecars, raw Mail/source objects and local environment files can contain sensitive data. Preserve recovery assets; do not add them to Git or delete them during documentation work. Backup coverage and proven restore remain separate claims.
