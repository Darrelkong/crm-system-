# Basic Organize F3 — local implementation / release gate

2026-09-27. Base: `a481689ad3854b85dfa6073c9aa495453659fb58` (main).
Branch: `feat/basic-organize-cloudflare-ai`. NOT deployed. No F1/F2/Smart Ingest code merged.

## Accepted behavior and actual entry points

New Customer `new-customer-form.tsx` notes and New Follow-up
`new-follow-up-form.tsx` summary share `FollowUpOrganizeControls`.
Previously Basic Organize ran deterministic browser cleanup; its service mode
also used rules. The adjacent AI Organize action has a separate external-provider
path. Basic Organize did not call Gemini.

Basic Organize now uses the existing authenticated draft/customer organize routes
with `mode: basic`, then `AI_SERVICE` → crm-ai `basic_text_organize` → Workers AI.
The existing customer permission/pending-confirmation checks remain in front of
the customer route. The draft route retains the same authentication boundary as
New Customer and rejects a supplied customer ID. The separate external-provider
organizer and Customer Insight Gemini logic are unchanged.

Only the current text, locale, task and schema version cross the service binding.
No customer context, identifiers, history, Mail, Knowledge retrieval or extra
fields are sent. Basic mode does not resolve external-provider settings or consume
Customer Insight quotas. Existing GET availability still describes the separate
AI Organize button.

## Contract and recovery

- Existing Qwen model (`@cf/qwen/qwen3-30b-a3b-fp8`), one invocation per click,
  no automatic retry, 20-second Worker deadline / 23-second adapter wait.
- Input 5–2000 characters; output at most 3000 characters. JSON `{text}` only.
- Prompt permits punctuation, sentence breaks and grammar smoothing only,
  preserving input language/script, names, facts, conditions and uncertainty.
- Shared Worker/app guard compares protected token sequences, including numbers,
  dates, currencies, percentages, phones, emails, URLs, and common uncertainty,
  negation and condition markers. Added, removed or altered tokens reject output.
  Length bounds, common script-conversion checks and strict shape checks also apply.
- These are conservative checks, not a proof of complete semantic equivalence.
  Arbitrary names/regions or subtle meaning changes cannot be exhaustively checked
  by regex. Original/proposal review remains required; real-model fluency has not
  been validated in this local-only task.
- Original and proposal remain separate until explicit acceptance. The user can
  keep the original or accept and edit normally. A newer edit invalidates adoption
  of a stale proposal. Errors preserve input and leave normal form submission usable.
- Synchronous submission lock prevents repeated click calls; per-customer component
  identity and request generation prevent late responses crossing form changes.
- New task logs no input, output or provider exception. Existing gateway invocation
  disables collection. No persistence, migration, secrets or config change required.

## Local evidence

Commands:

```sh
NODE_ENV=test node --import tsx --test src/lib/ai/follow-up-organize/*.test.ts src/app/api/ai/follow-up-organize/*.test.ts src/i18n/locales/phase4c-parity.test.ts src/i18n/locales/catalog-parity.test.ts
npm run crm-ai:test
./node_modules/.bin/tsc --noEmit
npm run crm-ai:typecheck
npm run build
git diff --check
```

- App/route/fidelity/catalog regressions: 50 PASS, 0 FAIL.
- Worker task and existing Worker regressions: 73 PASS, 0 FAIL.
- Total: 123 distinct test cases. New fluency examples use controlled model replies,
  including Simplified/Traditional Chinese, clean English, numeric/contact fidelity,
  uncertainty, malformed output, timeout/unavailability and forbidden input scope.
- Real route handlers execute against isolated mocks: unauthorized/invalid requests
  make no AI call; permitted requests send only selected text. Gemini/provider
  resolution is a failing test seam and is not invoked by basic mode.
- Actual component in a localhost-only synthetic fixture: 10 immediate attempts
  produced one POST; proposal did not overwrite input before acceptance; failure
  retained text; editing during a delayed response disabled adoption of that result.
- Main TypeScript and Next.js production build passed. Changed-file ESLint passed
  with zero errors and four existing Worker service unused-variable warnings.
- Production-source crm-ai typecheck is NOT passing: baseline
  `workers/crm-ai/src/knowledge-vision.ts:83` has TS2322 (`string` to JPEG/PNG union).
  No F3 production-source diagnostic was reported. The main baseline lacked the
  script; this branch adds a source-only config using existing env.d.ts/compiler
  settings and installed types. F3A explicitly leaves the unrelated Vision file unchanged.

Initial catalog tests ran alongside locale generation and saw stale generated
catalogs; the recorded pass follows completed generation. An initial test-only
route mock lacked a schema export; the fixture was corrected. Neither involved
relaxing production checks. No remote AI, Production, D1 or Cloudflare operation ran.

## F3A differential gate — 2026-09-27

Owner approved a zero-new-diagnostics gate and prohibited fixing Knowledge Vision
or importing Smart Ingest 2. A separate clean detached worktree of exact main
`a481689ad3854b85dfa6073c9aa495453659fb58` was checked against F3 using the same
installed TypeScript binary, source-only compiler settings and dependencies.
No baseline tracked or untracked source/config file was changed; its Git status
remained clean. Existing dependencies were locally copied, not installed/upgraded.

Because main has no npm typecheck script or source-only config, an external
`/tmp/crm-f3a-typecheck.json` used F3's existing settings, with absolute paths rooted
in each checkout for extends/include/exclude/typeRoots. Both checkouts ran the
identical command `tsc --project /tmp/crm-f3a-typecheck.json --pretty false` using
the F3 worktree's installed binary. F3's `npm run crm-ai:typecheck` was also rerun
and returned the identical diagnostic.

| Checkout | Count | File / position | Code / category |
| --- | --- | --- | --- |
| Pristine main | 1 | workers/crm-ai/src/knowledge-vision.ts(83,5) | TS2322 / error |
| F3 | 1 | workers/crm-ai/src/knowledge-vision.ts(83,5) | TS2322 / error |

Exact message: `Type 'string' is not assignable to type '"image/jpeg" | "image/png"'.`
Normalized diagnostic sets are identical. New F3 diagnostics: **0**. No diagnostic
points to an F3-added/modified file. Classification:
**BASELINE KNOWN ISSUE — NOT F3 REGRESSION**. Absolute Worker typecheck remains
nonzero; the approved differential gate passes. The F3 source-only configuration
was authored on this main-based branch; no SI2 configuration or commit was imported.

F3A reran the 50 app/route/catalog and 73 Worker tests: **123 PASS / 0 FAIL**.
Main TypeScript, changed-file ESLint (four existing warnings), Next.js production
build and diff whitespace checks passed. No runtime correction was made in F3A.

A future release needs
the compatible crm-ai task deployed before the CRM caller; deployment requires
separate authorization. There is no schema/backfill requirement. Real Workers AI
language/fluency acceptance remains separate from mocked contract evidence.
