# Integration 1B — reviewed CRM candidate

2026-09-30. Repository: `Darrelkong/crm-system-`.
Branch: `integration/crm-reviewed-features`.

**Candidate assembled; narrow structural checks PASS. Integration 1C validation
PENDING. NOT PRODUCTION DEPLOYED.** This is not a main-merge, migration or release
authorization. No cross-feature behavior, browser, build or migration suite was
run in 1B.

## Provenance and ref freshness

`git fetch origin --prune` completed before integration. Local and refreshed
remote-tracking refs matched every reviewed SHA exactly. No substituted tip was
used. Main remains `a481689ad3854b85dfa6073c9aa495453659fb58`.

| Unit | Exact accepted tip | Explicit integration merge |
| --- | --- | --- |
| SI2 | `b66bb9e0ad90c948a773c914ca18811bac1e83e8` | `a273bd9523dfb86516cfcf1689fbe50bbc928e2e` |
| F4, including F1 | `c3e2e35da23ef5e3746bab1c8892c786c636f0ee` | `6b057e91b7e63afebb99695e4f753008fe808190` |
| F2 | `b525dca809fc4627e9ac61424926a2e75f445d23` | `a7f2fe58d9b23c15647e6654ad59b89104155180` |
| F3 | `820f92c0cf28866c25c78dda9629e58505440855` | `ef9acf1e07726a08ac88c30373abefbbcc2a1002` |

Each merge used `--no-ff` and preserved accepted feature history. F1
`146f50f266adbe028ab029c3f6047f794b94e26d` is already an ancestor of F4 and was
not separately merged or cherry-picked. F4G `f8a12ea`, F4H `62cd6d8` and F4I
`c3e2e35` remain ancestors. Feature refs were not moved.

The dedicated worktree is
`/Users/darrell/.codex/worktrees/crm-reviewed-integration/crm-system`.
Its ignored `node_modules` symlink reuses existing installed repository dependencies;
no install, upgrade or lockfile change was needed. Existing feature worktrees,
local fixtures, stashes and backups were preserved.

## Conflict resolutions

- SI2 and F2 merged without conflicts.
- F4 conflicted only in `public/locales/en.json`, `zh-Hans.json`, `zh-Hant.json`.
  Source catalogs merged cleanly; `npm run generate:locales` resolved the generated
  files from the combined source, without selecting a whole branch's JSON.
- F3 conflicted in the same generated files and `package.json`. The package
  resolution retains SI2's `crm-ai:typecheck` and F3's exact `crm-ai:test` list,
  including `workers/crm-ai/tests/basic-organize.test.ts`.
- The shared Worker dispatcher/types and Drizzle export barrel merged cleanly.
  No application runtime file required a manual conflict edit.

The final source/generated catalogs contain the exact union of the accepted
F3/F4/SI2 key/value changes, with 4,251 keys in each language and no lost key.
F4H `{{rating}}` / `{{time}}` / `{{reason}}` and F4I's
`CUSTOMER_RATING_REQUIRED → followUps.chooseRating` mapping are retained.

## Preserved runtime and schema boundaries

Basic Organize retains its separate `basic_text_organize` request/result and
dispatch path, selected-text/locale input, Qwen model, deadline, single provider
invocation, preview-before-apply and safety diagnostics. Knowledge organize,
compare, QA, Vision and category suggestion remain Workers AI tasks with their
own contracts/retries. Comparison-specific Preview model/deadline overrides do
not become Basic Organize defaults. Customer Insight Gemini stays separate.

F1 follow-up idempotency and F4 human-rating transactions/CAS/history remain
intact. F2's 28px blur, separate prefixed/unprefixed support rules, privacy-safe
fallbacks, watermark and interaction blocking remain intact. F4G lifecycle,
F4H interpolation and F4I localization hotfixes remain unchanged.

The five SQL files are byte-identical to their accepted tips:

1. `0087_knowledge_business_category_mappings.sql`
2. `0088_knowledge_source_segment_candidates.sql`
3. `0089_knowledge_ai_organization_candidate.sql`
4. `0090_knowledge_candidate_compare_convert.sql`
5. `0091_human_customer_rating.sql`

No 0092 or renumbering. Schema exports retain Knowledge mappings/candidates and
customer rating history. Fresh integrated order is 0087 → 0088 → 0089 → 0090 →
0091. F4's prior local A/B/C evidence is preserved; full integrated migration
validation is assigned to 1C. No local or remote migration ran in 1B.

## Acceptance and documentation authority

The owner explicitly confirmed for Integration 1B:

- F1 implemented/accepted as F4's intentional dependency.
- F2 implemented/accepted locally.
- F3 implemented/real-AI accepted in its approved isolated environment.
- **F4 LOCAL ACCEPTANCE COMPLETE / F4F-R PASS**, retaining F4G/H/I.
- SI2 standalone acceptance and isolated Preview evidence retained.

These are inherited acceptance facts, not newly executed tests or fresh remote
resource observations. Earlier feature ledgers remain historical evidence;
pending F4 browser wording is superseded. SI2's permanent documentation remains
the foundation, updated with integrated architecture, permissions, module status,
source migrations and release boundaries. Unrelated open product decisions and
Mail backlog are unchanged.

## Narrow structural validation

Executed from the isolated integration worktree:

```sh
npm run generate:locales
NODE_ENV=test node --import tsx --test src/i18n/locales/catalog-parity.test.ts
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
npm run crm-ai:typecheck
git diff --check
```

- Locale generation and existing catalog consistency tests: **3 PASS / 0 FAIL**.
- Additional read-only assertions: three-locale key parity; exact accepted
  branch key/value union; F4H placeholders; unchanged migration bytes; expected
  schema exports; all reviewed tips contained in ancestry.
- All 210 non-overlapping accepted runtime/test/config files remain byte-for-byte
  identical to their owning feature tip; F4G lifecycle and F4I resolver are intact.
- Main TypeScript: **PASS**, no diagnostics.
- crm-ai production-source TypeScript: **PASS**, no diagnostics. SI2's reviewed
  config/Vision correction and F3's shared contract coexist.
- Diff whitespace: **PASS**.

No broad feature regression, behavior/browser acceptance, AI call, build or
migration test was performed. Those are not implied by successful typechecks.

## Next boundary

Integration 1C requires separate authorization for focused cross-feature
validation. Later Production preflight must compare the full applied/pending
migration filename sets, verify bindings and compatible service versions, and
establish a protected recovery checkpoint/Time Travel bookmark strategy before
any authorized migration. Code rollback does not undo migrations or business
writes. Canonical future main deployment remains `npm run deploy:production`.

No main change, Production query/migration/deploy, Preview deploy, Cloudflare
mutation, R2 mutation or Mail side effect occurred. Integration-branch push is
authorized only after the candidate is committed and clean; it does not authorize
a PR, main merge, 1C execution or release.
