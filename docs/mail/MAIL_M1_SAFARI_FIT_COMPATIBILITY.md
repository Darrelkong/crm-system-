# M1 Safari mobile-fit compatibility correction

2026-10-05. **READY FOR PHYSICAL RECHECK — PHYSICAL SAFARI RECHECK REQUIRED.**

Base: `fix/mail-mobile-reader-continuity` at preserved commit `f23ef755d27c5508b16020b52a0350eb24c6ef77`. This correction is uncommitted. The preserved checkpoint, public Round C runtime on port 3340, its tunnel and older port-3000 runtime were not changed. No Production, infrastructure, migration, transport, dependency-manifest or M2/M3 change.

## Evidence and narrow correction

The owner's physical iPhone Safari observation is valid: the flexible Professional HTML message offered width modes and became smaller in Fit. Its exact Safari internal geometry remains unavailable. Installed Safari WebDriver requires enabling remote automation; it was not enabled. Playwright WebKit is not installed. Chromium success is not Safari acceptance.

The confirmed implementation weakness was trusting `body.scrollWidth` alone after constraining the iframe to reader width. This cannot distinguish an intrinsic scroll-extent artifact from rendered overflow. A controlled browser counterexample forces that property to 600 while the flexible table renders at 358. The exact preserved component fails the new assertion (false fitting); the corrected component passes. This demonstrates the weakness, not the physical Safari root cause.

Only the width measurement changes: a DOM Range over the body contents measures the rightmost rendered element/text bounds relative to the body origin. Including text runs preserves extreme pre/nowrap overflow even when the containing block itself fits. The existing one-pixel control tolerance absorbs rounding; genuine overflow rounds upward. Range construction does not select user text or mutate sender DOM. The iframe is still measured at available width before expansion; synchronous geometry reads and existing ResizeObserver/requestAnimationFrame scheduling retain layout/image settlement behavior. Scale, mobile breakpoint, Original Width control, height reservation, message-mode reset and media-query pinning remain unchanged.

No viewport meta or text-size-adjust override was added. Neither was proven causal, and changing either could independently affect responsive behavior or accessibility. No user-agent sniffing, fixture-name special case, sanitizer/CSS-policy change, sandbox relaxation or canonical body/quote mutation.

## Fresh validation

| Check | Actual result |
|---|---|
| New width helper tests | 4/4 PASS; included in focused total below |
| New real-renderer browser harness | 19/19 PASS, Chromium 153; loopback only, no D1 |
| Preserved-component counterexample | Expected FAIL on inflated intrinsic scroll width; initial flexible geometry passes |
| Focused units/security/quote/context | 182 tests: 181 PASS, 1 unchanged inherited attachment-action source-regex failure |
| Existing continuity lifecycle harness | 21/21 PASS; synthetic focus/visibility, two polling cycles, error retention and denied-access clearing |
| Authenticated isolated application browser | 58/58 PASS at 390×844, 390×600 and 1280×900 |
| TypeScript | `tsc --noEmit --incremental false` PASS |
| Scoped ESLint | PASS, zero errors/warnings |
| Canonical non-deploy production build | `npm run build` PASS in a separate build copy |
| Diff whitespace | `git diff --check` PASS |

The new browser harness covers flexible 600px/max-width tables, nested padded flexible tables, class/media responsiveness, inflated scroll-width counterexamples, fixed 800px tables, pre and nowrap text, mode reset on selection, contained original-width overflow, long flexible bottom/footer reachability at both mobile heights and unscaled desktop layout. It uses the real sanitizer and renderer, not a parallel implementation.

Authenticated regression retained fixed-mail scale 358/800 on mobile, scale 1 on desktop, both-mode bottom/footer reachability, responsive visibility, very-long-message completeness, A→B→A/default mode, Back/reopen, 65-second polling retention, remote default blocking, one explicit loopback image load without Referer/refetch on mode switching, authorized CID rendering and missing/duplicate placeholders. Reply/Reply All/Forward retain clean editable prefixes, separate safe read-only quotes, subject/metadata and self/Bcc exclusions. No external mail sent. Zero unexpected external resource attempts or page errors. Existing unit coverage of immutable quote/private-resource exclusion remains green; unchanged D1 authorization/service suites were not rerun.

The retained failing test is `mail-desktop-ux-regression.test.ts` → “moves desktop attachment action to the bottom action bar.” Its test and inspected compose source are unchanged from the preserved baseline; this is the previously documented source-regex debt, not an all-green suite claim.

## Isolation and reproducibility

Authenticated runtime: `/var/folders/4q/8s0trbh12bs9lmchml8qhkxw0000gn/T/crm-mail-safari-fit-d3ebmnkg`, loopback port 3350. It used an existing synthetic fixture snapshot, separate local D1/R2, dummy database identity, disabled outbound/notification transports and a private synthetic credential. No current Preview database was reseeded or modified. The fixture snapshot had 35 messages and clean FK/quick checks. Browser evidence is in that runtime's `evidence/browser.json`.

An initial test-environment attempt used the worktree's older Miniflare binaries against newer local fixture metadata and failed before authentication. The disposable runtime was corrected to use the already-installed Round C dependency tree, without installation or repository dependency changes. Cold compilation required a longer private browser-procedure wait. An initial build scanned an accidentally retained duplicate dependency tree and exhausted its heap; moving that preparation artifact outside the build root resolved it. No product-source workaround was used for these preparation failures.

Build copy: `/var/folders/4q/8s0trbh12bs9lmchml8qhkxw0000gn/T/crm-mail-safari-build-ajwfl2wg`. Both changed runtime files match the worktree in the tested application and build:

- `mail-isolated-html-document.tsx`: SHA-256 `17bae795c8d7d90e2a397f50f29080b9ec77aebe7a67907c3388befd78bb9e68`
- `mail-document-fit.ts`: SHA-256 `ad4924653cba14830451c90ea760a9187cb61f12f79ee3fe699d5e12bf0d3dd4`

Commands: `node --import tsx --test` for the new helper/component tests plus responsive CSS, inbound sanitizer/fidelity, CID/inert images, compose quote/reply, workspace context and desktop UX tests; `node scripts/test-mail-rendered-fit.mjs` with existing Playwright module/executable environment paths; `node scripts/test-mail-reader-continuity.mjs` with the existing Chromium driver. The existing authenticated M1H procedure was copied privately with only isolated runtime/port and cold-start wait changes; assertions were retained.

## Remaining gate

**PHYSICAL SAFARI RECHECK REQUIRED.** After separate approval to update the Round C preview, the owner need only open Professional HTML (no toggle/no shrink expected), then Wide email (Fit and Original Width still available). No geometry collection or engineering debugging is requested from the owner. This is not Human Round C PASS, frozen-SHA Round D, merge or deployment approval. The public Round C preview still serves the pre-fix commit until separately authorized.
