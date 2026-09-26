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

# ECHFRONT CRM — current deployment runbook

**Procedure documentation only. Nothing in this runbook was executed during 0F-A or 0F-B.** Chat/Human review completed on 2026-09-26 with required revisions, now recorded; open decisions remain. This is the current operational starting point, preserving older documents as historical evidence. Following a documented procedure still requires the owner's action/target authorization. Final documentation review is APPROVED — 2026-09-26; 0F-C authorizes docs-only commit and feature-branch push. No deployment, migration or Cloudflare modification is authorized by this gate.

Team Member refers to internal `staff` roles; identifiers remain unchanged. Product confirmation is separate from implementation and release approval. The [master spec](CRM_MASTER_SPEC.md) records owner-confirmed policies and drift; none authorizes a release or live Access change. Intended Access duration (1 week), CRM absolute ceiling (7 days in source) and CRM idle policy (30 minutes) remain separate; live Access duration was not verified by takeover.

## Identity, tools and preconditions

- Repository: `Darrelkong/crm-system-`, locally `/Users/darrell/Projects/crm-system`. ECHFRONT Global Website is outside scope.
- Production account: `809c05c9f500268e973938fd641eee39`.
- Production D1: `crm-db`, `03633dd2-c058-42de-9355-f5450eab7202`, main config `wrangler.jsonc`.
- Production baseline supplied by owner: main `a481689ad3854b85dfa6073c9aa495453659fb58`; the 0D version snapshot below is separate runtime evidence.
- Smart Ingest 2 feature HEAD: `d9e94c37fb1af503a116663b8da667db4d7fa6dd`; **NOT Production deployed**. 0087–0090 and Production Release Audit remain PENDING.
- Use the repository-installed tooling. Do not silently install or upgrade tools during an audit/release. The takeover observed Wrangler 4.136.1.

Before an authorized operation, confirm repository/branch/HEAD, clean or deliberately accounted-for worktree, account and exact config/resource targeting. Confirm credentials without printing them. If OAuth requires human renewal, stop for the human step; a whoami/remote call can refresh local credentials and is not automatically a filesystem-read-only action.

## Environment map

| Environment | Supported entry/mechanism | Boundaries and caveats |
| --- | --- | --- |
| Development | `npm run dev` | Next dev with local OpenNext bindings. `predev` regenerates locales. Inspect local binding/state selection; do not assume empty fixture data. |
| Local OpenNext Preview | `npm run preview` | Builds then previews locally; `prepreview` regenerates locales and build writes artifacts. Verify bindings, local persistence and transport flags first. |
| mail-preview | Allowed dev origin `mail-preview.echfronthk.com` in Next config | No live tunnel/service state was established in 0E. Obtain/inspect the actual approved local tunnel setup before use; do not invent a deployment command from the hostname. Mail read-source selection can show prototype fixtures. |
| Knowledge Preview | `npm run deploy:knowledge-preview` via guarded script | Remote mutation requiring approval. Isolated Knowledge D1/R2, shared `crm-ai`, real AI, outbound disabled. Current SI2 branch is **not allowlisted**. |
| Production | **`npm run deploy:production`** | Guarded main-source build and main Worker deploy. Requires release gates below. |

Local runs are not read-only audits. `predev`, `prebuild` and `prepreview` regenerate locale JSON; tests/builds can write local state/artifacts. Local development should use approved private environment values and isolated data. Never seed/restore customer or Mail Production data into an uncontrolled Preview environment.

### Knowledge Preview details

[Configuration](../wrangler.knowledge-preview.jsonc): Worker `crm-system-knowledge-preview`, D1 `crm-db-knowledge-preview` / `14b75c29-3faf-4389-8aa8-48f06fa75355`, R2 `crm-knowledge-sources-preview`, configured hostname `knowledge-preview.echfronthk.com`. It deliberately shares `crm-ai`; real inference can consume account usage.

[Deploy guard](../scripts/deploy-knowledge-preview.mjs) requires clean worktree and permits only `feat/knowledge-human-acceptance-preview` or `fix/knowledge-dedupe-image-extraction`. It checks isolated bindings/hostname, disabled email/large-file transport, Mock AI off, no cron/email binding and disabled workers.dev/preview URLs. `--check` checks the script guard; it is not a full deployment or runtime validation.

The script builds with `NEXT_PUBLIC_MAIL_READ_SOURCE=preview`, which maps to prototype Mail in the current client selector. A Knowledge Preview acceptance therefore does not verify Production Mail. Do not bypass/change the branch guard to release SI2 without a separately approved change and Preview plan.

[Mail test config](../wrangler.mail-test.jsonc) names Production resources despite use in a local-only harness. [Local gateway config](../wrangler.echfront-mail-files.local.jsonc) is distinct from [Production gateway config](../wrangler.echfronthk-mail-files.production.jsonc). Check flags and targets, not filenames alone.

## Production release gates

Complete and record each gate for the named release; unresolved gates stop the release. The existence of a package command does not satisfy them.

| Step | Gate | Required evidence/action |
| --- | --- | --- |
| 1 | Approved branch / SHA | Owner-approved scope and exact source; clean/accounted worktree; reviewed diff and dependencies. |
| 2 | Full relevant test gate | Domain tests, integration isolation, type/build and appropriate browser checks; actual commands, SHA, environment and outcomes. Test-file existence is insufficient. |
| 3 | Production Release Audit | Compatibility, permission/data boundaries, pending migrations, Worker/binding changes, unresolved risks and acceptance evidence reviewed together. |
| 4 | Backup / recovery checkpoint | Known coverage and restore procedure for affected D1/R2 data; protected checkpoint and rehearsed or explicitly accepted recovery limitations. |
| 5 | Migration compatibility | Exact pending set, existing data/index constraints, old/new Worker coexistence and rollback/forward-fix plan reviewed. |
| 6 | Explicit human approval | Concrete source, targets, SQL/migration set, operational side effects, release window and risk decision approved. |
| 7 | Merge to main | Approved Git workflow publishes the reviewed source to main/origin main; any conflict resolution requires renewed relevant validation. No ad hoc history rewriting. |
| 8 | Production migration | Execute only the approved migration set against explicit verified remote config/DB; record metadata/result without customer data. |
| 9 | crm-ai deployment when required | Deploy compatible task contract before a caller depends on it; record Worker version and approved checks. |
| 10 | crm-system deployment | Use canonical `npm run deploy:production`; preserve source/build/version evidence. |
| 11 | Independent Workers only if changed | Deploy only named approved changed Workers/configs; no blanket redeploy. Gateway has its own guard. |
| 12 | Smoke test | Use approved actors/data and check affected flows, negative permission cases, mobile behavior and runtime errors. Sending mail or mutating records requires scope. |
| 13 | Version recording | Capture final source/build SHA, migration boundary, each changed Worker version/deployment, time and smoke result; update current docs. |
| 14 | Rollback decision | Explicit go/no-go based on observations; invoke only the pre-reviewed compatible rollback/forward-fix path with approval. |

For SI2, the prospective coordinated set is migrations 0087–0090, the new `knowledge_category_suggest` AI capability and main CRM candidate workflows. This is a dependency assessment, **not a release authorization**. Candidate conversion concurrency, recovery coverage and Preview guard/validation scope must be resolved or explicitly accepted in the release audit.

### Relevant validation selection

Read [package scripts](../package.json) rather than assuming `npm test` discovers everything. CRM domain commands include auth, permissions, Public Pool, customer/user/recycle checks; Knowledge/SI2 has additional explicitly selected tests and local D1 integration cases. Include the AI category-suggestion test separately until its omission from `crm-ai:test` is resolved. Current suites and exact latest pass results are separate facts.

The [serial D1 harness](../scripts/test-mail-d1-serial.mjs) creates temporary local databases and applies migrations. Verify local-only flags and fixture targeting. Build/locale generation writes files, so inspect any resulting diff before release. Browser checks should cover named desktop/mobile flows and negative authorization paths, not just successful rendering.

## Canonical main CRM deployment

After all required approvals/gates, the main CRM command is:

```sh
npm run deploy:production
```

[deploy-production.mjs](../scripts/deploy-production.mjs) fetches origin main, requires branch `main`, matching `HEAD == origin/main`, a clean worktree and no package/lockfile diff, removes stale `.open-next` output, regenerates locales and builds OpenNext with `NEXT_PUBLIC_MAIL_READ_SOURCE=production`. It records `.open-next/.release-meta.json` with source SHA/build time/`production-release`, validates the artifact against the source and deploys through installed OpenNext tooling. `npm run deploy` delegates to this path.

**Do not substitute standalone Wrangler deployment for `crm-system`.** It bypasses the source/build guard and real-Mail build selection. Do not remove guard checks because a feature branch or dirty worktree fails them.

The script does not run the full test gate, create a recovery checkpoint, apply D1 migrations, deploy `crm-ai` or independent Workers, or obtain release approval. Its success does not imply those steps occurred. Bootstrap secrets support is a separately authorized flow; it is not the ordinary release command and must never expose credential contents.

## crm-ai and independent Worker mechanisms

The following are documented mutation mechanisms, **not commands to run during 0F-A**. Most independent package scripts use installed Wrangler directly and do not inherit the main release guard, so manually satisfy source/target/review gates first.

| Target | Repository command | Configuration |
| --- | --- | --- |
| `crm-ai` | `npm run crm-ai:deploy` | [workers/crm-ai/wrangler.jsonc](../workers/crm-ai/wrangler.jsonc); installed Wrangler deploy with explicit config. |
| Reclamation | `npm run cron:deploy` | [wrangler.cron.jsonc](../wrangler.cron.jsonc) |
| Backup | `npm run cron:backup:deploy` | [wrangler.backup-cron.jsonc](../wrangler.backup-cron.jsonc) |
| Recycle | `npm run cron:recycle:deploy` | [wrangler.recycle-cron.jsonc](../wrangler.recycle-cron.jsonc) |
| Mail jobs | `npm run cron:mail:deploy` | [wrangler.mail-jobs-cron.jsonc](../wrangler.mail-jobs-cron.jsonc) |
| Inbound Mail | `npm run inbound-mail:deploy` | [wrangler.inbound-mail.jsonc](../wrangler.inbound-mail.jsonc) |
| Mail-files gateway | `npm run deploy:mail-files:production` | [Guarded deploy script](../scripts/deploy-mail-files-production.mjs), [production config](../wrangler.echfronthk-mail-files.production.jsonc) |

Gateway deployment checks main-source state, config and existence of its required secret by metadata. Gateway bootstrap can create/change secrets/resources and requires separate explicit authorization. Dry-run/precheck script names are not proof that every action is read-only; inspect before a restricted audit.

No independent Worker source change is automatically required by the SI2 feature. Confirm the actual release diff before deciding that any must be redeployed.

## D1 migration safety

At the 2026-09-26 snapshot, Production `d1_migrations` ends at 0086. 0087–0090 are pending. The local main config specifies no custom tracking table. If future config differs, resolve the configured table instead of assuming the default.

The installed Wrangler `d1 migrations list` can initialize the tracking table with `CREATE TABLE IF NOT EXISTS`; **do not use it for a strict read-only audit**. 0D-C's one-query permission has been consumed. Any renewed migration-state query needs authorization covering that query. A permitted metadata query should select only tracking metadata, target the verified remote DB/config, and report no business data.

For a separately approved migration release, the explicit-target apply shape is:

```sh
./node_modules/.bin/wrangler d1 migrations apply crm-db --remote --config wrangler.jsonc
```

This applies the pending migrations recognized by the tool; it is **not limited to four files by the command text**. Before approval/execution, verify that the exact pending set equals the reviewed set. Stop if unexpected migrations, account/DB mismatch, schema uncertainty or recovery incompatibility appears. Do not use generic remote seed/backfill commands as part of migration.

Historical migrations contain table rebuilds (including approvals/Mail and 0086 segments). 0087–0090 are principally additive but 0089/0090 also change indexes/uniqueness. Review collisions, old/new query behavior, ordering and rollback compatibility rather than assuming "additive" means risk-free. No automated down-migration guarantee exists.

## Backup and recovery checkpoint

The [JSON table list](../src/lib/backup/constants.ts) currently covers 26 named tables. Password hashes and sessions are excluded; Mail, Knowledge, authorized devices and R2 object bytes are not a complete part of that export. The users projection is also selective. Therefore an application JSON backup is **not a full-system recovery image**.

0C identified local D1/R2 state, sidecars and historical SQL exports; some are valuable unique assets, while at least one nominal SQL backup was only a PRAGMA stub. File existence/size/name is insufficient. A WAL-safe [local D1 snapshot helper](../scripts/local-d1-safe-backup.mjs) exists; copying only a live SQLite main file can miss sidecar state.

Before a data-affecting release, establish scope for D1 metadata/data, R2 objects and object references, configuration and privately managed credentials. Record checkpoint time, source/schema boundary, protected location, coverage, integrity checks and the procedure to restore into an isolated target. Define RPO/RTO with the owner. Rehearse restored constraints, representative workflows and object readability before claiming recoverability. Do not place backup data or secrets in this public repository.

The older deployed backup Worker version does not prove parity with current export code. No full-system restore was demonstrated in 0E/0F-A. Local assets/stashes/backup branches must be preserved until separate disposition approval. `npm run auto:backup` is a timer-driven Git add/commit/push tool, **not a read-only or full-data backup procedure**; do not start it implicitly.

## Smoke testing and recording

Prepare test actors/data and expected outcomes before approval. For SI2 this includes secondary unlock/roles, confirmed-segment candidate creation, manual override precedence, segment isolation, independent organization, stale comparison rejection, conversion/Open Draft/revisit, multi-candidate lineage and unauthorized actor cases. Any concurrency fix needs actual concurrent/failure-path verification, not only sequential replay.

Check main/AI compatibility and permissions without exposing source/customer/Mail content in logs. Mail changes require approved recipients and transport scope; gateway tests must not publish token URLs. Check Production Mock AI remains off. A read-only resource audit cannot be reported as a successful end-to-end smoke test.

Record the approved release source, final main/build SHA, migrations applied, each changed Worker deployment/version ID, UTC time, validation commands/results, human acceptance scope and residual risks. Replace dated snapshot entries deliberately, retaining decision/release history; never overwrite an unknown with a guess.

## Rollback philosophy

Rollback is a new Production operation requiring explicit approval. Decide whether to stop dispatch, roll back a compatible Worker version or deliver a guarded forward fix using the pre-approved incident plan. Check compatibility of old main/AI code with the current D1 schema, existing candidate state and any messages/files already created.

**No destructive schema rollback by default.** Do not drop new columns/tables, restore an old DB over current business data, or replay sends to undo an application deploy. Prefer preserving data and forward remediation when reverse migration risks loss. Version rollback does not undo migrations, sent mail or R2 mutation. If the canonical guard cannot represent an intended rollback, obtain an explicit reviewed rollback procedure; do not bypass it ad hoc.

## Dated Production version snapshot

Observed in 0D-B on **2026-09-26**; no remote refresh in 0F-A. All listed versions had 100% deployment allocation at that observation. These IDs are evidence, not permanent desired-state constants. Dates below are UTC deployment dates; exact main/AI timestamps are preserved where available.

| Worker | Active version ID | Deployment observed |
| --- | --- | --- |
| `crm-system` | `bac77519-b8a4-4328-bdd0-74fa17e6c75b` | 2026-09-24 13:14:04.653776Z; deployment `dbd12426-e408-42ba-a3c4-c2af3592c9e7` |
| `crm-ai` | `faeee75f-bd8e-45e1-9cc1-b5a1d004902c` | 2026-09-23 14:31:34.435928Z; deployment `ac5dd4f3-bc95-4020-a6de-a9534251bafa` |
| `crm-system-mail-jobs-cron` | `e63d3eff-ead5-4644-bf2a-cefbe1fc7cf9` | 2026-09-09 |
| `crm-system-backup-cron` | `0c2a3adc-3aa4-4d3f-b826-a5bf1a4387ee` | 2026-06-30 |
| `crm-system-reclamation-cron` | `7d7d7bce-e239-4d43-b997-c4577c42deed` | 2026-09-06 |
| `crm-system-recycle-cron` | `ed58172c-4be6-4ff8-8b0c-a3b6f5ef33f9` | 2026-06-30 |
| `crm-system-inbound-mail` | `3cd4decd-78b8-4b16-968d-9b2c2ed385ea` | 2026-09-02 |
| `echfront-mail-files` | `b25109c3-5003-4365-a8fc-f1d08fb06572` | 2026-09-09 |

0D verified main D1/R2/AI/self/assets bindings and large-attachment runtime/send flags enabled. Production Mock AI was not enabled. It did not prove all independent Worker binding values, live custom-domain routing/DNS/Access policy, R2 object cleanup or end-to-end runtime correctness. Revalidate only within the scope of a future authorized release/audit.

## Stop and escalation conditions

Stop for mismatched repository/account/resource, dirty/unreviewed release source, unexpected pending migrations, stale/unavailable test evidence, unresolved schema compatibility, missing recovery checkpoint, unauthorized external mail/file effects, needed secret/Access/DNS changes, credential exposure risk or a proposed action outside human approval. Present concrete evidence and the smallest decision needed; do not execute first and ask afterward.
