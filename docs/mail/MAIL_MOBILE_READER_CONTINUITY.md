# Post-M1 mobile reader continuity — local work in progress

2026-10-03. Branch `fix/mail-mobile-reader-continuity`, base `6273fbda2beb6a6fab7859cdf1feaaf3ce913e4c`.

**LOCAL CORRECTIONS IMPLEMENTED; REMAINING BROWSER ACCEPTANCE BLOCKED. NOT COMMITTED, PUSHED, MERGED OR DEPLOYED.** This evidence does not certify physical iPhone gestures or resolve every reported rich-mail presentation problem.

## Demonstrated selection defect and correction

The production revalidation component calls `refreshMessages()` on focus, visible-state return and a 60-second interval. The store previously called `loadMessages(reset:true)`, which cleared the selected ID/body even when `sameFolderRefresh` retained the list. The new real-store regression failed on the baseline (`null` instead of `message-1`). The authenticated local browser reproduced the empty detail after polling without pressing Back: the Back control remained, with “Select a message to read.” This is a detail-clearing path, not evidence that every reported automatic Inbox navigation shares that cause.

Only background refresh now requests selection preservation. Deliberate mailbox/folder/search loading retains the clearing behavior and invalidates pending detail responses. The open detail is independently revalidated through its existing authorized API; absence from page one cannot prove deletion. Network/server errors retain the document. Current 401/403 clear sensitive state; unavailable detail 404 clears selection. Newer detail requests/navigation/logout invalidate older results. No authorization endpoint, polling interval, session clearing, privacy overlay, storage or persistence policy changed. No email body or credentials are put in localStorage.

The refresh adds one authorized detail GET per active-reader refresh, alongside the existing list GET. It does not create a second polling timer. This is bounded but does transfer the body again; there is no new persistent cache.

A separate notification/deep-link path also reproduced a request storm after opening local `/mail?messageId=m1b-long_html`: server output contained repeated same-message GETs, including a further burst after browser interaction was unavailable. Its effect depends on the changing workspace snapshot and calls `selectMessage`, which synchronously publishes another snapshot. A narrow guard is now prepared: wait for list bootstrap, consume each link once, and depend on the stable selection callback/individual state fields. It does not re-open a link on polling, resize or ordinary store updates. **Post-fix browser verification for this guard is pending; do not call the second defect fixed yet.** TypeScript, scoped lint and the final canonical build pass with this guard. The local server was stopped after verifying its PID/cwd to contain the request storm. The runtime/fixtures are preserved. This is distinct from the reproduced plain `/mail` polling-clear path. It does not prove that every phone Inbox-return report came from a notification link.

## Mobile layout and measured reader behavior

Only the mobile/default production pane moves subject, sender and timestamp into the existing primary vertical scroller. Full addresses and permitted recipient groups remain in expandable native Details. Desktop metadata placement is unchanged. Reply / Forward / More stay fixed above CRM navigation. Existing global Mail/system header, nav height and safe-area rules are unchanged.

| 390 × 844 local fixture | Before | After |
|---|---:|---:|
| Fixed message metadata height | 137px | 0px outside scroller |
| Primary scroller client height | 468px | 605px |
| Compact metadata within scroller | n/a | 81px |
| Scroller bottom | 709px | 709px |
| Fixed actions bottom | 778px | 778px |
| LONG_HTML scroll height | content retained | 400327px |
| LONG_HTML bottom scrollTop | n/a | 399722px |

The pre-fix468px area is derived from the captured header/footer bounds (241–709px); the corrected605px clientHeight is directly measured. The137px gain is about29%. Metadata naturally moves above the viewport. The final LONG_HTML marker, attachment and fixed actions are visible after ordinary wheel scrolling. The 10,003-paragraph body remains 307,834 stored HTML characters under **inbound-v2**, not v5. No content shortening was used.

[Before](mobile-continuity-evidence/mobile-before.png) · [Baseline empty detail after poll](mobile-continuity-evidence/mobile-baseline-after-poll.png) · [After top](mobile-continuity-evidence/mobile-after-top.png) · [After bottom](mobile-continuity-evidence/mobile-after-bottom.png).

The screenshots are the local development app; Next tools and the development-only DBG control are not Production evidence. The accepted production debug exclusion is unchanged.

## Evidence categories

- **Real store tests:** 49 pass, including off-page selection, repeated background refresh, list/detail network errors, 401/403/404, late responses after Back/folder/mailbox/search/logout and stale denial after a newer successful response.
- **Synthetic browser lifecycle:** 21 assertions pass using the real workspace provider, real revalidation effect and real isolated production reader under StrictMode. Only session and translation fixtures are substituted. DOM hidden/visible and focus events plus captured poll callbacks retain the same iframe/contentDocument and scrollTop; hidden state makes zero requests; each eligible event makes one list/detail pair. Network failure retains the document; access denial removes it. No lifecycle errors. These are synthetic events, not phone home-screen evidence.
- **Authenticated actual application:** existing disposable local D1 and emulated R2, real `/mail` production-read-source, 12 cases / 226 assertions pass at 1280×900 and390×844. LONG_HTML, legacy table newsletter, quoted history, wide content, enterprise table and Apple-style fixture preserve content, one outer scroller, end/footer/action reachability, isolation and stable height. Long selection remained at scrollTop399722 across multiple actual60-second polls. Ordinary wheel scroll was used; no forced marker scroll.
- **Unfinished:** reduced-height viewport; new fixed-column and visibility-rule fixtures in the actual reader; plain-text revisit; fresh CID/remote-image browser checks after the layout change; post-fix direct-link regression. The Mac/UI service became unavailable before these were completed. Existing accepted CID/privacy evidence is preserved, not relabeled as a new pass.
- **Physical/device:** no real touch, iPhone Safari/WebKit, browser suspension/process eviction, orientation keyboard or hardware safe-area test. No established authenticated built-app D1/R2 bridge exists; dev-browser and production compilation are distinct evidence.

## Visual fidelity triage — no sanitizer change

Read-only local metadata confirms legacy fixtures are inbound-v2, enterprise/Apple fixtures inbound-v3 and new diagnostic fixtures inbound-v5. A received-date alone cannot establish the reported Production iCloud message's stored sanitizer version; no real message was queried or reprocessed.

- Legacy 600px newsletter: old canonical HTML lost width/padding; rendered table319.29px at both tested widths, heading32px. This supports upstream information loss, not a new mobile reader scale operation.
- Enterprise v3: original/sanitized width600px + max-width100%, padding24px; renders600px desktop and358px mobile; Georgia32px retained.
- Apple-like v3: source/sanitized/rendered heading48px on both viewports. Large sender typography is preserved deliberately; the reader did not inflate it. Its mobile text area is310px after sender24px padding.
- Wide preformatted fixture: iframe expands to21963px; outer document stays390px. Horizontal overflow is contained, but panning such content is cumbersome. The horizontal wrapper computes overflow-y:auto with no vertical range. Potential touch chaining/iframe boundary stalls remain **unproven** in the available wheel engine; pointer interaction, selection, links, zoom and navigation were not disabled.
- New fixed-column fixture retains800px width,400px cells,48px/32px headings and24px padding through the actual MIME parser/sanitizer. Browser measurement is pending.
- New responsive duplicate fixture loses style/class/media rules and retains both safe links. Two focused parser tests pass. Do not deduplicate links by text. This proves the storage-side mechanism for that synthetic design, not the exact reported iCloud message.

Smallest separate proposal: evaluate a versioned, parser-based CSS allowlist restricted to isolated email documents, including bounded responsive visibility rules, with URL/import/active CSS negatives. No dependency or sanitizer expansion is authorized by this patch. Legacy missing CSS cannot be recovered by that future contract; historical reprocessing remains a separate decision. No global font/table flattening is proposed.

## Reproduction and validation

Runtime: `/var/folders/4q/8s0trbh12bs9lmchml8qhkxw0000gn/T/crm-mail-mobile-fdjrcob9`, loopback3299, cloned accepted synthetic fixture state. Exact dummy D1 ID00000000-0000-4000-8000-0000000001b0, `remote:false`; local emulated attachments bucket; no service/AI/email bindings; all outbound/notification transports disabled. Existing installed Wrangler4.136 dependency tree is reused for the copied local state; no dependency installed or upgraded. Source worktree remains isolated from main. No Production checkpoint data is involved.

Commands:

```sh
node --import tsx --test src/lib/mail/client/mail-workspace-context.test.ts
node scripts/test-mail-reader-continuity.mjs
node --import tsx scripts/mail-reader-geometry/seed-mobile.ts --local # ONLY exact guarded disposable runtime
node --import tsx --test scripts/mail-reader-geometry/mobile-fixtures.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
npm run build # isolated source copy, dummy config, production read-source; no deploy
```

Existing `runFidelity` browser harness was reused through permitted CUA with expected fingerprints derived from canonical synthetic inputs. Initial missing-manifest-fingerprint failures were corrected by supplying expectations, not weakening checks. [Geometry/assertions](mobile-continuity-evidence/reader-geometry.json), [summary](mobile-continuity-evidence/reader-summary.json), [lifecycle](mobile-continuity-evidence/synthetic-lifecycle.json), [stored versions](mobile-continuity-evidence/body-versions.json).

Focused existing unit selection:128 tests,127 pass,1 inherited `mail-desktop-ux-regression.test.ts` “moves desktop attachment action to the bottom action bar” source-regex failure; its test and compose implementation are unchanged. Additional inert-image/locale/fidelity/store selection85/85 (includes the49 store tests, not additive unique coverage). Visual parser tests2/2. TypeScript passes. Scoped ESLint has zero errors and six inherited warnings (five in the shell, one in the store). Canonical non-deploy `npm run build` passes on the final source copy including the prepared deep-link guard (exit0); only the existing middleware deprecation warning remains. The guard still needs browser regression. `git diff --check` passes. The worktree intentionally remains uncommitted until pending browser gates are finished. No broad historical suite rerun, migration, remote operation or send.

## Completion gate

Restore normal browser access, finish the explicitly pending cases, then inspect staged scope and commit/push only this branch. Do not merge or deploy. Physical-device symptoms and legacy/responsive presentation remain separately qualified even if the scoped correction passes.

## Exact changed paths

Runtime: `src/components/mail/prototype/mail-prototype-shell.tsx`, `src/lib/mail/client/mail-workspace-context.tsx`, `src/components/mail/prototype/mail-production-reading-pane.tsx`, `src/components/mail/prototype/mail-production-message-actions.tsx`.

Regression/fixtures: `src/lib/mail/client/mail-workspace-context.test.ts`, `scripts/fixtures/mail-reader-continuity.tsx`, `scripts/test-mail-reader-continuity.mjs`, `scripts/mail-reader-geometry/mobile-fixtures.ts`, `scripts/mail-reader-geometry/mobile-fixtures.test.ts`, `scripts/mail-reader-geometry/seed-mobile.ts`.

Documentation: this file, `docs/CRM_MODULE_STATUS.md`, and the eight files in `docs/mail/mobile-continuity-evidence/` (four synthetic screenshots, body versions, reader geometry/summary, synthetic lifecycle). No schema, sanitizer, isolated-document, auth, deployment/configuration, main or existing feature-branch change.
