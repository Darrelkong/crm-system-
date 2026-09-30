# Basic Organize F3 — local implementation / release gate

## Current integration status — 2026-09-30

F3 is implemented and real-AI accepted in its approved isolated environment, as explicitly confirmed by the owner. Earlier local-only / remaining-real-AI statements below are historical gate evidence. SI2 now supplies its reviewed typecheck configuration and Vision fix; the old F3A baseline diagnostic is not the integrated typecheck status.

Included in [Integration 1B](CRM_INTEGRATION_1B.md), candidate only. **NOT
PRODUCTION DEPLOYED. Integration 1C validation is PENDING.** Historical standalone
branch/base statements and test evidence below remain preserved; integration does
not retroactively turn those tests into cross-feature validation.

## Standalone origin and historical evidence

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

Historical F3/F3A commands (the failing typecheck script was removed in F3B below):

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
  script; F3 initially added a source-only config using existing env.d.ts/compiler
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

## F3B release-quality cleanup — 2026-09-27

Removed only the new `crm-ai:typecheck` npm script and
`workers/crm-ai/tsconfig.build.json`, so this branch does not introduce a known-failing
canonical command. The F3A differential evidence above remains valid historical
evidence. Knowledge Vision and all Basic Organize runtime/test code are unchanged;
the Basic Organize test remains included in `crm-ai:test`. No SI2 fixes imported.

Local bundle check (installed Wrangler 4.136.1):

```sh
WRANGLER_SEND_METRICS=false ./node_modules/.bin/wrangler deploy --dry-run --config workers/crm-ai/wrangler.jsonc --outdir /tmp/crm-f3b-worker-bundle --metafile /tmp/crm-f3b-worker-bundle/meta.json
```

PASS: 73.45 KiB / gzip 15.04 KiB; dry-run exited without uploading or deploying.
The esbuild metadata has 15 inputs: 14 crm-ai source modules and the shared
`src/lib/ai/follow-up-organize/fluency-contract.ts`. There are zero final external
imports. The bundle contains the task dispatcher and fact guard; no Next.js,
OpenNext, server-only or Customer Insight module enters this Worker bundle.
No config, binding, secret or remote resource changed.

Rechecked the existing contracts: basic mode returns through AI_SERVICE before
external-provider resolution; only selected text/locale plus task/version travel
to the Worker; one invocation per click; permissions precede invocation; original
and proposal remain separate; stale proposals cannot apply; factual token guards
remain active. The customer route reads its existing permission metadata locally
to authorize the request, but sends no customer profile/history to AI.

F3B validation: app/route/catalog 50 PASS, Worker 73 PASS; main TypeScript,
changed-file ESLint (zero errors, four baseline warnings), Next.js production
build, Wrangler dry-run and `git diff --check` PASS. The baseline Worker semantic
diagnostic was not rerun or repaired in F3B. Remaining remote acceptance:
**REAL WORKERS AI QUALITY VALIDATION**. Nothing has been deployed.

## F3D rejection diagnostics — local gate

Adds safe internal rejection reasons for `basic_text_organize` only: empty provider
response, unsupported envelope, non-stop finish, JSON parse, object shape, empty
text, output length, forbidden markup, factual tokens, script and length ratio.
The existing ordered predicates are preserved. The boolean/parser API delegates
 to the diagnostic helper; accepted output and public `{ok:false,error:"invalid_output"}`
remain unchanged. No prompt, model, schema, token/deadline limit or retry change.

Rejected requests log only task/model/locale, fixed reason/envelope/type labels,
allowlisted finish reason (unrecognized values become `other`), character counts,
duration, and optional token-pattern index/counts. Never log text, matched tokens,
prompts, reasoning, provider errors or arbitrary provider keys. Token pattern
index 8 denotes the existing uncertainty/negation/condition pattern; counts alone
cannot identify which token changed. API consumers receive no internal reason.

Local validation: 76 Worker tests and 46 app/route tests pass. New tests exercise
all emitted rejection categories, safe HTTP behavior, metadata key allowlisting,
untrusted finish-reason redaction and unchanged valid responses. A disposable
old/new contract differential checked 296 input/output/shape combinations with
identical acceptance results. An initial mock-cleanup API error in new tests was
corrected; no runtime safety rule changed. Main TypeScript, changed-file ESLint,
Next.js build, Wrangler dry-run and diff check pass. Remote Case 4 reproduction is
separate evidence; maximum two authorized requests, no quality remediation here.
