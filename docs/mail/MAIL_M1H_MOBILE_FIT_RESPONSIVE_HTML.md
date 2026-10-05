# Mail M1H — mobile fit and bounded responsive HTML

2026-10-04. **M1H PASS WITH DOCUMENTED LIMITATION.** Local implementation and engineering evidence only; complete M1 closeout and physical-device UX remain pending. **NOT COMMITTED, NOT MERGED, NOT DEPLOYED.**

## Baseline and preservation

Worktree: `/Users/darrell/.codex/worktrees/mail-mobile-reader-continuity/crm-system`, branch `fix/mail-mobile-reader-continuity`, HEAD `6273fbda2beb6a6fab7859cdf1feaaf3ce913e4c`. Existing dirty Mobile Continuity source and evidence were preserved. A pre-edit SHA-256 manifest covers 2,867 existing files. The existing continuity runtime components/context and their test remain byte-identical to that manifest. Only the existing mobile fixture test changes its v5-loss expectations to v6 retention expectations; the earlier evidence is not rewritten.

The original Preview PID 58691, port 3000, temp source copy and database were not restarted, synchronized or edited. M1H acceptance used a separate source copy at `/var/folders/4q/8s0trbh12bs9lmchml8qhkxw0000gn/T/crm-mail-mobile-m1h-wv0omk5c`, port 3330. This runtime has a dummy D1 identity, local Miniflare D1/R2, disabled transport, and no remote/service/AI/email binding. Existing synthetic fixtures were copied to isolated storage; only this disposable storage received additional M1H fixtures and normal login/read/draft effects. No Production access, migration, send, infrastructure change or credential reset occurred.

## Root causes and implementation

The isolated document previously expanded to its natural width and exposed horizontal panning without a fitted mobile mode. Inbound-v5 discarded every stylesheet and class, so safe visibility rules could not survive new materialization. These are separate reader geometry and canonical sanitization limitations.

The existing isolated renderer now measures natural width and height, uses a proportional CSS transform on mobile (the existing 767px boundary), and reserves the scaled height in a sizing wrapper. It does not rewrite sender markup, resize CRM controls or modify canonical quote HTML. Flexible content and desktop content remain scale 1. The reader retains one outer vertical scroll owner; the iframe is sized to the full natural document height.

A localized **Original width / Fit to screen** button appears only when mobile content is wider than its reader. Original width uses scale 1 with contained horizontal scrolling. Mode switches retain the iframe/document and loaded image nodes. New-message mounting restores the default fitted state. No preference storage or Mail-state mutation is introduced.

Validated media queries are evaluated against the reader's available width, not the expanded natural iframe width. A WeakMap preserves each original query while trusted parent measurement updates its CSSOM media condition. Therefore switching to original width does not accidentally change mobile visibility to desktop visibility. ResizeObserver/rAF and viewport resize handling update geometry after resizing or image loading.

During initial browser verification, CRM's existing descendant max-width rule capped the new sizing wrapper and prevented original-width panning. The wrapper now explicitly has `maxWidth: none`; the host still bounds horizontal overflow. Final tests exercise ordinary horizontal wheel panning and both-mode bottom reachability. No global CSS was changed.

## Inbound-v6 CSS/security contract

Newly materialized bodies use **inbound-v6**. Installed PostCSS parses stylesheet ASTs; htmlparser2 locates style content. Original style nodes are discarded by the existing HTML sanitizer. Only newly serialized allowlisted CSS is prepended to the sanitized body. No dependency was installed or upgraded.

- Supported selectors: allowed HTML element and/or ASCII class tokens, bounded descendant/child combinations and comma lists. No ID, universal, attribute, pseudo or escaped selectors; no html/body selectors. Maximum 512 selector characters, eight selector components/eight classes per component and 32 comma alternatives.
- Only referenced class names survive (up to 32 tokens, 64 characters each). A class name provides no trust and cannot escape the iframe.
- Declarations reuse the existing anchored inline presentation property/value allowlist: bounded dimensions, spacing, borders/colors, safe typography, text wrapping/alignment and table properties. Stylesheet rules additionally permit `display: none|block|inline|inline-block|table|table-row|table-cell` and `visibility: visible|hidden|collapse`. Allowed declarations may retain `!important`.
- Media support: one level of `@media`, optional `screen and`/`only screen and`, one or two ANDed integer-pixel min/max-width bounds from 0 to 2000. Every enclosed declaration uses the same allowlist. Other media features, query lists and nested at-rules are not supported.
- Parsing budget: 65,536 accumulated style-text code units, 256 visited nodes/rules, 2,048 declaration visits; emitted values capped at 256 characters. Malformed sheets fail closed. This is a bounded email subset, not general stylesheet support.
- Imports, font/resource loads, CSS URLs, position/z-index overlays, pointer-events tricks, animations, custom properties, var/calc/expression constructs, escapes and active markup remain excluded. Unsupported selector/property/value/at-rule content is dropped.
- Existing script/event/form/SVG/embed and unsafe-link bans remain. The iframe remains `sandbox="allow-same-origin"` with **no scripts permission**, its existing CSP and no-referrer policy. Sender CSS cannot affect CRM ancestors.

Remote/CID descriptors remain inert until the existing authorized activation paths. Remote images require explicit per-view opt-in; CID remains authenticated and message-scoped. No permission, schema, transport or object delivery policy changed.

`sanitizeQuoteHtml()` explicitly uses the previous no-stylesheet sanitization mode. **Quote-v1/outbound permissions are not expanded by inbound-v6.** Reader fitting never changes canonical quote content. Safe inline quote formatting remains; stylesheet/class fidelity in outgoing quotes is outside this change.

## Exact changed files for M1H

Runtime:

- `src/components/mail/mail-isolated-html-document.tsx`
- `src/components/mail/mail-message-body-renderer.tsx`
- `src/lib/mail/client/mail-document-fit.ts` (new)
- `src/lib/mail/mail-responsive-css.ts` (new)
- `src/lib/mail/inbound-body-html-sanitizer.ts`
- `src/lib/mail/compose-body-html.ts` (preserve the existing outbound boundary)
- `src/i18n/locales/{en,zh-Hans,zh-Hant}.ts` and generated `public/locales/{en,zh-Hans,zh-Hant}.json`

Tests/harnesses:

- `src/lib/mail/mail-responsive-css.test.ts` (new)
- `src/lib/mail/inbound-body-html-fidelity.test.ts`
- `src/lib/mail/cid-image.test.ts` (version expectation only)
- `scripts/mail-reader-geometry/mobile-fixtures.test.ts`
- `scripts/mail-reader-geometry/m1h-fixtures.ts` (new)
- `scripts/mail-reader-geometry/seed-m1h.ts` (new, disposable local runtime guard)
- `scripts/mail-reader-geometry/m1h-browser.mjs` (new)

Documentation: this record, `docs/mail/m1h-evidence/`, and an appended M1H entry in `docs/CRM_MODULE_STATUS.md`. Other dirty files belong to the preserved Mobile Continuity package.

## Actual validation

| Validation | Result | Environment |
|---|---|---|
| Focused units/security/quotes/context/debug controls | 182 tests: 181 pass, 1 inherited failure | Target worktree; no live DB writes |
| New responsive CSS/geometry tests (included above) | 18/18 pass | Target worktree |
| CID materialization + quote/approval D1 integrations | 28/28 pass | Separate local D1 harnesses, dummy identities, private local storage |
| Existing continuity lifecycle browser | 21/21 assertions pass | Isolated browser/component harness with mocked API; no D1 |
| New authenticated M1H browser matrix | 58/58 checks pass | Disposable port-3330 application; Chromium 153 / playwright-core 1.63.0 |
| TypeScript `tsc --noEmit --incremental false` | PASS | Target worktree |
| Focused ESLint | 0 errors, 0 warnings | M1H runtime/tests/locales |
| Canonical `npm run build` | PASS | Separate build copy, production mode, public debug flag deliberately true |
| `git diff --check` | PASS | Target worktree |

The single inherited failure is `mail-desktop-ux-regression.test.ts` → **moves desktop attachment action to the bottom action bar**, the unchanged source-regex mismatch around approval submission. Neither that test nor its inspected compose implementation changed in M1H. It was not weakened, skipped or removed. This is not a claim that all repository tests pass.

Focused unit command used `node --import tsx --test` with: `mail-responsive-css.test.ts`, `inbound-body-html-sanitizer.test.ts`, `inbound-body-html-fidelity.test.ts`, `cid-image.test.ts`, `inert-image.test.ts`, `compose-quote-fidelity.test.ts`, `client/compose-reply-body.test.ts`, `client/mail-workspace-context.test.ts`, `scripts/mail-reader-geometry/mobile-fixtures.test.ts`, `mail-debug-controls.test.ts`, and `client/mail-desktop-ux-regression.test.ts`. Integration command used `--test-concurrency=1` with `cid-materialization.integration.test.ts` and `compose-quote-fidelity.integration.test.ts`. Lifecycle command: `node scripts/test-mail-reader-continuity.mjs`.

The first isolated build attempt rejected an external node_modules symlink. The final successful build used a private filesystem clone of the same installed dependencies, without installation. Initial cold-login and desktop pointer-target probes were procedure/environment issues; corrected probes and the final full matrix passed. No large unrelated CRM suite was repeated.

## Browser geometry and evidence

[Final 58-check browser evidence](m1h-evidence/browser.json), [separate 21-check lifecycle evidence](m1h-evidence/lifecycle.json), [390×844](m1h-evidence/responsive-390x844.png), [390×600](m1h-evidence/responsive-390x600.png), [1280×900](m1h-evidence/responsive-1280x900.png).

| Fixture/viewport | Observed result |
|---|---|
| Fixed 800px, 390×844 | Host 358px; fitted scale 0.4475; document width 390px; primary scroller 605px; scrollHeight 5,638px |
| Same, 390×600 | Same fit; primary scroller 361px; no bottom-navigation obstruction |
| Original width, both mobile heights | Natural width 800px, scale 1; contained horizontal range 442px; vertical host range 0; final marker/footer reachable |
| Natural document dimensions | 800×12,206px; fitted visual height ≈5,462.19px; wrapper rounds height upward |
| Desktop 1280×900 | Scale 1; ordinary content not shrunk; final marker reachable |
| Responsive fixture | Mobile-only visible / desktop-only hidden, padding 12px; desktop reverses visibility with padding 24px; original-width mode retains mobile rules |
| Flexible mail | Scale 1 and no meaningless width control |
| Extreme pre | Proportional overview under 0.1 scale; original-width access exceeds 10,000px, contained within reader |
| Existing 10k-paragraph message | Natural height >400,000px, scale 1, actual end/footer reachable |

Authenticated browser polling waited 65 seconds: one `/api/mail/me`, one list refresh and one active-detail refresh (all 200), retaining the exact scroller/iframe/document and nonzero scrollTop. Message switching and Back/reopen were exercised repeatedly; new selection resets width mode. Final run: 61 Mail responses at 200, three synthetic draft creations at 201, zero failed Mail responses and zero page errors. Dev preload advisories are retained in evidence; no update-depth, render, ResizeObserver or request loop was observed.

The separate lifecycle harness exercises hidden→visible, focus, two polling cycles, network failure retaining the reader, and 403 removing private content. Its synthetic visibility evidence is not an iPhone app-switch test.

Hostile fixture: zero active elements/events/script sentinel execution and zero unexpected external attempts. The only permitted image request was one explicit opt-in to a loopback canary, with no Referer. Switching original/fit afterward retained the document/images and did not refetch. Late image layout still reached the final marker. CID single/multiple loaded through authorized local endpoints; missing/duplicate displayed unavailable state. The 28 D1 tests cover negative authorization, non-image/bad bytes/missing objects and immutable outbound payload boundaries.

Reply, Reply All and Forward opened with clean editable prefixes, isolated read-only quotes, expected subject/metadata and self/Bcc exclusion. No automatic remote load occurred. No real mail was sent. The production debug exclusion tests pass; screenshots intentionally show the isolated development runtime, not production-build UI verification.

## Limits and next gate

- Historically stripped classes/styles/images cannot be reconstructed from old canonical rows. No historical reparse, body rewrite, backfill or migration is attempted. This is historical information loss, distinct from the new renderer preserving available v6 CSS.
- The bounded CSS subset deliberately excludes many legitimate but more complex sender constructs (pseudo/attribute selectors, arbitrary media features, flex/grid, animation, external fonts, positioning). This is not pixel-perfect arbitrary-email fidelity.
- Proportional fitting can make text small, especially extreme preformatted content. Original width supplies full-scale inspection and text selection; physical-phone readability/gesture judgment remains required.
- Fresh browser evidence is headless Chromium in a disposable development app. Physical iPhone, Safari/WebKit, touch, keyboard, owner desktop UX Round C and frozen-SHA Round D were not completed. The production build passed but was not separately browser-served for this task.
- Original Preview PID 58691 does not contain M1H and cannot supply M1H human acceptance until a separately authorized runtime update. No automatic sync/restart was performed.
- The worktree is still dirty and uncommitted, with no M1H feature commit/remote backup. Removal could lose both packages.

**Next: M1 final engineering closeout review**, retaining these limits and the separately required human/frozen-SHA gates. This is not whole-Mail or Production Ready approval. M2–M5 were not started.
