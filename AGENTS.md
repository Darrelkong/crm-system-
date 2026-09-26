# ECHFRONT CRM — mandatory agent entry point

This repository is **ECHFRONT CRM** (`Darrelkong/crm-system-`), not ECHFRONT Global Website. Never access or modify the website repository unless separately authorized.

## Read before substantial CRM work

1. `AGENTS.md`
2. [Current product specification](docs/CRM_MASTER_SPEC.md)
3. [Architecture](docs/CRM_ARCHITECTURE.md)
4. [Module status and evidence](docs/CRM_MODULE_STATUS.md)
5. [Security and permissions](docs/CRM_SECURITY_AND_PERMISSIONS.md)
6. [Deployment runbook](docs/CRM_DEPLOYMENT_RUNBOOK.md)
7. [Implementation plan and approval state](docs/CRM_IMPLEMENTATION_PLAN.md)
8. [Decision log](docs/CRM_DECISIONS.md)

Last Human Product Review: **2026-09-26 — CHAT/HUMAN REVIEW COMPLETED; OPEN DECISIONS REMAIN DOCUMENTED**. **0F FINAL DOCUMENTATION REVIEW: APPROVED — 2026-09-26**. 0F-A: PASS WITH REQUIRED REVISIONS. 0F-B: CORRECTIONS COMPLETED. 0F-C: AUTHORIZED FOR DOCS-ONLY COMMIT AND FEATURE-BRANCH PUSH. `CURRENT` does not grant implementation or release approval. Recheck branch, HEAD and worktree before acting. Smart Ingest 2 is implemented, Human Accepted and Engineering Closeout Accepted, **NOT Production deployed**; Production was verified through migration 0086, with 0087–0090 pending.

## Evidence and historical documents

Use this order: current code → schema/migrations → current tests → Cloudflare-verified Production baseline → 0E audit → historical repository docs → historical plans. Test existence does not prove a pass, and local code does not prove a deployment. Old phase, release and incident documents are evidence, not automatically the current specification. Unknown product intent is `HUMAN DECISION REQUIRED`; unapproved historical ideas remain `HISTORICAL PROPOSAL — NOT CURRENTLY APPROVED`.

This order establishes implementation facts; explicit owner-confirmed product rules establish intended behavior. Record any conflict as product/implementation drift instead of silently replacing either side. 0F-B confirms product direction, not permission to change code or release it.

## Production safety and stop conditions

Explicit human approval covering the operation and target is required before:

- Production D1 queries beyond approved read-only metadata; any Production migration, deploy or rollback.
- Cloudflare secret changes, Access or DNS changes, R2 mutation, or mail side effects.
- Repository visibility changes or Git history rewriting.

Stop when repository/account/resource identity is uncertain, a requested read may write, credentials need human renewal, secret values might be exposed, or the next action exceeds the approved scope. Clarify conflicting product decisions and release/schema compatibility before proceeding. Preserve local-only assets, stashes and backups; cleanup requires separate authorization. Existing explicit authorization remains valid within its stated scope; documentation is not authorization.

Main CRM Production deployment uses **`npm run deploy:production`**. Do not substitute standalone Wrangler deployment for `crm-system`. Read the runbook for separate Worker deployments and release gates. Production Mock AI must remain off.

## Durable domain invariants

- User-facing terminology is **团队成员** (Simplified Chinese), **團隊成員** (Traditional Chinese), **Team Member** (English). Internal `staff`, `Staff` and `role=staff` identifiers may remain; no source-code terminology refactor is implied.
- Team Member Public Pool uses random claim; pre-claim privacy is enforced server-side.
- Public Pool claiming is independently controlled per Team Member (default disabled for new members, per-member quota/cooldown); disabling claiming must not reclaim existing customers. Collaboration is long-term by default, with no removal for an individual's lack of follow-ups. See the master spec for implementation-verification gaps.
- Cloudflare Access, CRM session and Knowledge unlock are distinct.
- Business taxonomy != Knowledge Category taxonomy; human category/business override beats automatic suggestion.
- Knowledge AI cannot invent unsupported evidence; candidate evidence remains segment-scoped.
- One Source may create multiple Candidate Articles.
- Mail read permission != send-as permission; Team Member outbound mail uses immutable revision + approval.
- Normal and large attachments have separate storage and lifecycle.
- Backup file existence != proven restore capability.

## Validation and documentation maintenance

Select tests by the touched domain and check actual entry-point coverage. Never report full test PASS from test-file existence. Local integration harnesses may create and migrate local databases; verify isolation before running them. Do not use Production as test data.

Update the relevant current CRM document in the same task when architecture, module status, permissions, deployment flow or accepted product behavior changes. Record dated evidence, test results and Production versions separately. Do not turn the implementation plan into automatic permission to work.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
