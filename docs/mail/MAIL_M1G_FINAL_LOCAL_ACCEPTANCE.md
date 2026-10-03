# Mail M1G — final local acceptance

**2026-10-03 — M1G PASS WITH DOCUMENTED LIMITATION**

**NOT MERGED TO MAIN · NOT DEPLOYED · 0092 NOT APPLIED REMOTELY · NO REAL MAIL SENT**

## Candidate identity and release contents

Accepted starting branch `fix/mail-reply-forward-quote-fidelity`, tip `4e3a9e07dda91e6a2a9086c8f922ae6168ce3259`, initially clean. This report and the narrow production-debug exclusion are committed together as a descendant of that tip; the containing commit is the final M1G candidate.

Both canonical CRM main `88bb671af20ca75d43facc1a64049798d906524b` and accepted M1E-C `4dc8cd1f193d4a167f24c2b42f045cb3d7bc4495` are ancestors. The Customers page is byte-identical to canonical main, including the relationship-filter fix. Migration0092 and the accepted CID schema are unchanged from M1E-C. There is no0093 or duplicate migration numbering. No Wrangler, deployment script, dependency, Worker binding, auth configuration or Global Website change enters this release.

The [complete categorized release file inventory](m1g-evidence/release-files.json) separates runtime/product, migration/schema, tests/harnesses and documentation/evidence. Runtime/product: **39 files**; schema/migration: **2 files**; tests/harnesses: **33 files**. The only M1G runtime change is `mail-debug-controls.tsx`.

The exact eventual-main patch is reproducible without reconstructing history:

```sh
git diff 88bb671af20ca75d43facc1a64049798d906524b HEAD -- src public drizzle \
  ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' ':(exclude)src/lib/mail/test-fixtures/**'
```

An explicit runtime/schema-path patch was also saved outside Git as `release-runtime.patch` in the evidence root below, SHA-256 `2d19f77f10671d2d73f6119d64ba63675d38ee340ee5174f4eec4b552fe22fa8`. No runtime diff is hidden by a migration/configuration change.

## Local isolation and evidence

Only disposable synthetic Mail data was used. The established real `/mail` production-read-source implementation ran at `http://127.0.0.1:3299` against the existing M1 local runtime, dummy local D1 and emulated local R2. All resource bindings are local, no AI/service/email binding exists, and notification/outbound/verification transports are disabled. Browser automation used the permitted Codex CUA adapter. No dependency installation, external transport, remote D1 query, Production operation or Cloudflare mutation occurred.

Raw logs and original probe results are retained privately under:

`/var/folders/4q/8s0trbh12bs9lmchml8qhkxw0000gn/T/crm-mail-m1g-5hwee7sa`

Selected durable evidence: [browser totals](m1g-evidence/browser-summary.json), [per-case checks and geometry](m1g-evidence/browser-measurements.json), [log paths/hashes/totals](m1g-evidence/validation-log-index.json), [runtime observations](m1g-evidence/runtime-observations.json).

## Migration0092

`0092_mail_message_attachment_cid_metadata.sql` SHA-256 remains:

`ff9675e71658efd26f35884d3dd3f00bb73fc8ef35ba675dd0bf1dda0f82944c`

Two isolated local D1 migration tests passed: fresh canonical setup through0086 then0087→0088→0089→0090→0091→0092, and0091→0092. They verify exact tracking, preserved old rows/body, NULL/NULL historical metadata, valid/invalid constraint values, allowed duplicates, case-sensitive lookup, the partial index/query plan and preserved composite foreign keys. `foreign_key_check` is empty; D1 `quick_check` and closed-local-SQLite `integrity_check` are `ok`. No rebuild, backfill, raw MIME reparse or unrelated schema change.

Old explicit writes work with0092. The new CID materializer against0091 fails on missing columns; no silent fallback is introduced. Future release must apply0092 before new CID code and ship the long-autosave client/server contract together. These are compatibility requirements, not release authorization.

## Integrated browser acceptance

| Coverage | Cases | Passing assertions |
|---|---:|---:|
| Reader: M1C/M1D at1280×900,390×844; reduced390×600 | 19 | 321 |
| CID: existing eight fixtures plus a real MIME-materialized JPEG | 18 | 218 |
| Remote-image privacy and explicit local-canary opt-in | 18 | 300 |
| Reply / Reply All / Forward, expanded long quote, reduced height | 26 | 316 |
| **Total** | **81** | **1,155** |

Two additional plain-text reader smokes and saved-long-draft re-entry/reload checks passed. The source LONG_HTML fixture was not shortened. Enterprise/nested tables, Apple-like text hierarchy, quoted history, wide/preformatted content, image-only messages and hostile HTML/CSS remained covered.

The reader's bounded `flex-1 overflow-y-auto` body remains its primary vertical scroll owner; compose uses `.mail-compose-body-scroll`. The script-disabled document has no independent vertical scroll range. Normal wheel gestures reach final markers; attachment/footer/actions are reachable and hit-tested, with no document horizontal overflow or bottom-nav obstruction. Sender typography remains isolated from CRM CSS. No script, event, form, embed or SVG active content appears.

Example LONG_HTML geometry:

| Measurement | Reader desktop | Reloaded compose390×844 |
|---|---:|---:|
| Primary scroller clientHeight | 591 | 355 |
| Primary scroller scrollHeight | 400230 | 400551 |
| Observed bottom scrollTop | 399639 | 400196 |
| Isolated document height | 400104 | 400184 |
| End marker reachable / footer uncovered | PASS | PASS |

[Reloaded mobile end screenshot](m1g-evidence/mobile-reloaded-long-end.png). Reopening the saved draft after a full page reload retains the identical editable prefix, **10,004 quote paragraphs** including the header, and200,011 text characters: [record](m1g-evidence/reentry-reload.json).

Initial cold compilation/image settlement probes and one missing expected-fingerprint argument were rerun with correct invocation/settled UI. Initial failures are retained in the private evidence root, not called successful runs. No product assertion was weakened, skipped or relabeled. The summary identifies exactly which corrected cases supersede those probes.

## Privacy, CID and quote boundaries

Remote message content makes **zero requests before explicit opt-in**. Explicit tests contact only the local canary's allowlisted image paths, with no referrer; tracking pixels are initially blocked. Image-only remote content remains meaningful before loading. Reply/Reply All/Forward do not opt in automatically; quoted remote/CID descriptors become escaped image descriptions in immutable outgoing HTML rather than external/private URLs. No real Internet image request was needed.

PNG and JPEG render through the private authenticated current-message endpoint. Local D1/service negatives pass for wrong actor, disabled Mail access, inactive/wrong mailbox, wrong message/folder/trash context, missing object, guessed identity, blocked files, bad bytes and disallowed MIME. Duplicate CID rows are counted before filtering and fail closed. No filename/cross-message fallback or public R2 URL. Missing/duplicate/bad-byte fixtures retain a visible unavailable state; image-only valid CID remains readable.

Reply recipients/subject and Reply All To/Cc/self exclusion remain correct. Forward retains From/Date/Subject/To/Cc metadata and a clean editable prefix; Bcc is not disclosed. The quote stays read-only and visually separate, including nested/previous history. Existing attachment-selection and signature snapshot rules remain; previewing CID does not silently reattach it to outgoing mail.

Hostile HTML, malformed nesting/alt text, unsafe schemes, CSS URL/import/overlay attempts and private inline endpoint leakage are covered by sanitizer/quote tests, browser active-content checks, and locally constructed immutable provider payloads. Editable new content still uses the narrow existing outbound policy. No sender script permission was added; sandbox remains `allow-same-origin` **without** `allow-scripts`.

## Autosave, approval and send preparation

Nine local quote integration tests pass. The10,003-paragraph original is preserved by a sub-1KB editable-prefix request under the existing request cap and autosave version guard. Stale versions, mixed editable-prefix/combined HTML or text, unauthorized actors and non-seeded prefix mode are rejected. Legacy combined-body updates remain compatible.

M1G adds direct tests that a later prefix/recipient edit cannot mutate an already-submitted approval revision: revision body/from/signature reference, recipients, attachments, approval hash and recomputed revision hash remain unchanged. Existing draft/revision, approval and send-operation suites add **48 passing tests**, including separate read/send-as grants and Admin direct-send preparation. Their send adapter is fake/local; **no actual email was sent**. No permission/approval/transport implementation was changed by M1G.

## Production-build hygiene correction

The accepted debug component allowed `NEXT_PUBLIC_DEBUG_MAIL=true` to enable prototype controls even in production. M1G makes production exclusion unconditional and returns before entering the interactive prototype hooks. Development behavior remains available. Three real-component SSR tests prove production returns no markup with the flag absent, false or true.

A canonical local `npm run build` with `NEXT_PUBLIC_MAIL_READ_SOURCE=production` and deliberately **`NEXT_PUBLIC_DEBUG_MAIL=true`** passed. Client output has no DBG control label, known M1 synthetic actor ID, harness localhost3299 URL, canary.invalid/resource marker or local preview token. [Build hygiene evidence](m1g-evidence/build-hygiene.json).

Pre-existing local-preview route entries remain in the route manifest; this report does not claim the paths disappear from compilation. Their production guards return404/notFound before fixture/auth/resource work. Existing auth/Mail guard tests plus the Knowledge guard tests prove production disables them even with local flags. No harness route or fixture was added to application runtime.

## Test totals, known debt and limits

Unique selected automated tests (excluding duplicate reruns/baseline controls): **352 tests,346 PASS,6 inherited failures**.

| Suite | Pass | Fail |
|---|---:|---:|
| Focused Mail unit/source-wiring/security guards (31 files) | 253 | 3 |
| Migration0092 | 2 | 0 |
| CID materialization/authorization | 19 | 0 |
| Quote/autosave/approval integration | 9 | 0 |
| Draft/revision + approval + send-operation services | 48 | 0 |
| Older message-read-permissions suite | 8 | 3 |
| Actual debug SSR + existing Knowledge production guards | 7 | 0 |

All six remaining failures were independently reproduced on exact canonical main `88bb671` with isolated local fixtures:

1. `mail-desktop-ux-regression.test.ts`, “moves desktop attachment action to the bottom action bar”: stale literal `submitApproval` expectation.
2. `draft-management.test.ts`, “renders compose shell immediately with localized sender loading”: same stale literal.
3. `mail-compose-draft-final-regression.test.ts`, “sorts drafts by updated time descending on server and client”: expects `items` while implementation uses `page.items`.
4–6. `message-read-permissions.test.ts`: “denies users without mail access”, “allows personal mailbox members with can_read”, “denies suspended mailboxes”. Legacy personal-mailbox fixtures omit now-required `ownerUserId` and fail before the intended permission assertion. The current CID negative-permission suite passes. These fixtures/tests were not edited.

Baseline controls: source-regex48/51 and older permission8/11, reproducing the same six failures. Initial use of the older permission suite in the HTTP D1 harness was incompatible with its direct `getPlatformProxy` setup; the final/main-control results above use separately seeded local default D1. Setup failures are not represented as product passes.

TypeScript noEmit passes. ESLint: zero errors;15 warnings reproduced on canonical main in the broader touched scope, and no warning in the M1G changed scope. Production build passes; existing middleware deprecation remains. `git diff --check` passes. [Exact unit command](m1g-evidence/unit-final-command.json); D1 commands:

```sh
node --import tsx --test --test-concurrency=1 \
  src/lib/mail/schema/mail-cid-migration-d1.integration.test.ts \
  src/lib/mail/cid-materialization.integration.test.ts \
  src/lib/mail/compose-quote-fidelity.integration.test.ts
node scripts/test-mail-d1-serial.mjs \
  src/lib/mail/draft-outbound-revision.integration.test.ts \
  src/lib/mail/outbound-approval.integration.test.ts \
  src/lib/mail/send-operation.integration.test.ts
node --import tsx --test src/lib/mail/message-read-permissions.test.ts
node --import tsx --test src/components/mail/prototype/mail-debug-controls.test.ts \
  src/lib/knowledge/knowledge-preview-fixtures.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
npm run build
git diff --check
```

These commands were run in verified isolated copies/configurations with network-capable transports disabled, not against restored Production data.

Observed reader open times in the local development harness:537–2697ms, median770ms, including compilation/automation settlement; these are not Production benchmarks. A73-second idle sample shows five normal auth/Mail-session/health GETs, **zero** draft/body/CID requests and **zero** canary requests. No Maximum-update-depth, render-phase update or ResizeObserver loop was observed. One earlier `MutationObserver.observe` non-Node console error at09:15:10Z has no source/stack from the browser tool. It did not recur through subsequent cases/reload; attribution to app versus browser instrumentation is **unproven**, and it is explicitly retained as an observational limitation. No associated functional failure was demonstrated. The server's only4xx observations were the initial expired local session and three intentional bad-byte CID415 responses.

Remaining limitations: browser acceptance uses the authenticated Next development/local-resource path, not an authenticated production-build server (no established local built D1/R2 bridge). Physical iPhone/touch/software keyboard/Safari were not tested. No external mail transport or receiving-client rendering was exercised. Historical stripped HTML is not reconstructed; outgoing inline images remain descriptions unless separately selected under existing attachment rules. These limitations and inherited debt prevent an unqualified all-tests-green claim, but no unresolved blocking M1 functional/security failure was established.

The candidate is ready for a **separately authorized** integration/release decision with these limits. This acceptance does not merge, migrate, deploy, perform Production preflight, authorize release, or begin M2.
