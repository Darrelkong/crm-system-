# Mail M1F — Reply / Forward quote fidelity

**2026-10-03 — M1F REPLY / FORWARD QUOTE FIDELITY LOCALLY VALIDATED**
**NOT MERGED TO MAIN · NOT DEPLOYED · NO MAIL SENT**

## Lineage and scope

Branch: `fix/mail-reply-forward-quote-fidelity`.

- Starts from accepted M1E-C `4dc8cd1f193d4a167f24c2b42f045cb3d7bc4495`.
- Reconciliation merge `d0917243a9a2700d38a4c013268c836d68cda356` brings canonical main `88bb671af20ca75d43facc1a64049798d906524b` into this branch without rewriting either history. No conflict or uncertain semantic resolution occurred.
- Migration `0092_mail_message_attachment_cid_metadata.sql` is byte-identical to accepted M1E-C. No schema/migration changes or duplicate numbering. Customer page is byte-identical to canonical main, including the relationship-filter fix. Both accepted tips remain ancestors.
- R1 acceptance, Production, Global Website, M2 signatures, auto-reply, tracking and infrastructure are outside this task.

## Findings and correction

Before M1F, quote seeding, draft persistence/serialization and immutable revision creation all applied the narrow editable/outbound HTML sanitizer to the original message. Tables, headings, preformatted text and accepted inbound presentation were lost. Compose displayed the remainder with `dangerouslySetInnerHTML` inside CRM CSS. The source resolver preferred separately stored previous history over the current message when both existed.

M1F introduces a server-side **quote-v1 presentation contract** in `compose-body-html.ts`. The editable prefix retains the existing outbound sanitizer. The canonical quote retains the existing inbound-v5 safe presentation allowlist through seed, save, reload and immutable revision creation. No raw MIME is used. The inbound sanitizer itself is unchanged apart from exporting its existing tag list for the already-sanitized delivery transformation.

Current message content precedes separately stored previous history. HTML is preferred when available; plain-text originals use escaped `pre` content. HTML-only originals also retain a plain-text MIME fallback. Existing Reply / Reply All recipient derivation, self-address exclusion, Bcc policy, subject prefixes and threading rules are unchanged. Forward retains its original-message From/Date/Subject/To/Cc header and starts with an empty editable area. A nested quote remains structurally valid.

`MailComposeQuote` uses the accepted `MailMessageBodyRenderer` and `MailIsolatedHtmlDocument`. The quote is read-only; the new reply remains independently editable above it. Sender formatting does not enter the CRM DOM. The iframe keeps `sandbox="allow-same-origin"` with **no script permission**, the established CSP and parent ResizeObserver/rAF sizing. Its document has no competing vertical scroll range. The outer `.mail-compose-body-scroll` remains the compose scroll owner. Expanded compose no longer applies `overflow-hidden`/flex shrinking to that same scroll region; this is the only compose layout correction.

## Image and delivery boundary

- Remote descriptors remain inert. Quoting never opts into remote images. The established explicit per-view image-load control and no-referrer behavior remain unchanged.
- CID descriptors remain inert in saved HTML. For preview only, the source message ID loads the existing authenticated message detail/resource map. The existing inline endpoint rechecks message/mailbox/actor scope and validated bytes. A denied, missing or trashed source fails closed; there is no filename, other-message or cross-folder fallback.
- Source resource metadata is not included in the autosave payload. No public R2 URL or private authenticated URL is persisted into the outgoing quote.
- **Inline image preview is not outbound image reattachment.** At immutable revision creation, valid remote/CID descriptors become escaped textual descriptions. The outgoing HTML has neither descriptors nor image URLs. Existing attachment selection rules are unchanged, and seeding still does not silently attach source files.
- The localized compose notice explicitly explains this preview/delivery difference. Full outbound inline-image reconstruction would require separate scope; M1F does not invent it.
- Scripts, event handlers, forms, embeds, SVG, unsafe URL schemes, CSS imports/network URLs and overlay CSS remain stripped. New editable content does not acquire richer quote permissions. Hostile alt text remains escaped after the delivery transformation.
- Existing signature snapshot, approval, revision hash and transport semantics remain. Pure provider-payload construction confirms table formatting survives and the existing signature is appended once; no transport was invoked.

## Long quote autosave

Real browser testing exposed a pre-existing request-size failure: editing the 10,003-paragraph original resent the whole quoted HTML/text, yielding HTTP413. Raising the request cap or truncating the original would violate the goal.

An existing seeded draft now sends `editableBodyHtml` instead of its combined quote/body. The server obtains the canonical quote from the **author-authorized persisted draft**, sanitizes the editable prefix under the old policy, and recombines it under the existing autosave version/atomic guard. It derives text from the safe delivery representation. The request cap is unchanged. A combined `bodyHtml`/`bodyText` alongside this field is rejected; new drafts and legacy drafts without a recognized quote cannot use this mode. The older combined-body update remains compatible. No schema was added and source provenance cannot be changed through the draft update route.

The local D1 test proves a sub-1KB update retains all 10,003 original paragraphs, reloads intact, and rejects stale versions or mixed update representations without replacing the canonical quote. Client and server for this optional update field must be released together; this is not authorization to deploy.

## Local browser evidence

Only the established disposable M1 runtime was used:
`/var/folders/4q/8s0trbh12bs9lmchml8qhkxw0000gn/T/crm-mail-m1b-ZWJBkz`, at `http://127.0.0.1:3299/mail`.

The exact existing configuration has dummy local D1, emulated local R2, `remote:false`, no AI/service/email binding, and disabled outbound/notification transports. `prepare-compose.ts --local` refuses any other configuration/directory before adding the synthetic actor's local From identity/grant. Normal synthetic login, real production-read-source API, seeding, draft autosave and compose UI were exercised. No dependency was installed.

The new `quote-browser.mjs` uses only the permitted Codex browser adapter. It exercises actual Reply / Reply All / Forward controls, types above the quote, expands the original and uses ordinary wheel gestures, not `scrollIntoView` or scripted scrollTop. It records geometry, sandbox, image resources, active-content absence, final marker and footer hit testing. Close/save is observed before proceeding.

| Coverage | Result |
|---|---|
| Twelve quote fixtures at1280×900 and390×844 | 24 cases /292 assertions PASS |
| Expanded desktop long and enterprise quote | 2 cases /25 assertions PASS |
| Final CID-image-only Forward | 1 case /12 assertions PASS |
| Long quote at390×600 | 1 case /12 assertions PASS |
| Existing M1C/M1D reader regression | 12 cases /180 assertions PASS |
| Existing M1E-C CID regression | 16 cases /194 assertions PASS |
| Existing M1E remote image regression | 18 cases /300 assertions PASS |

The 28 quote cases total **341 assertions PASS**. Fixtures include long HTML, enterprise tables, Apple-style typography, prior quoted history, plain text, wide content, multiple CID images, CID image-only, remote image-only, tracking pixels, malicious HTML and CSS. Existing CID suite additionally covers missing, duplicate, wrong-message and bad-byte unavailable states.

| LONG_HTML quote | Desktop1280×900 | Mobile390×844 |
|---|---:|---:|
| Outer compose clientHeight | 264 | 355 |
| Outer compose scrollHeight | 400394 | 400551 |
| Wheel-reached scrollTop | 400130 | 400196 |
| Isolated document clientHeight / scrollHeight | 400184 /400184 | 400184 /400184 |
| End marker and Send hit test | PASS | PASS |

The short390×600 viewport has111px of body height. At absolute maximum the signature below the quote can move part of the quote's last line above that small viewport. A small ordinary upward wheel gesture makes the complete marker visible while Send remains uncovered. The harness preserves maximum-scroll evidence and tests **reachability**, not the incorrect assumption that a quote marker is the final DOM node.

Saved draft re-entry displays the previously typed prefix and the complete original (10,004 `p` nodes including the quote header). Draft rows were observed in descending saved-time order. Footer attachment controls remain available. No send/approval/delete action was triggered.

Evidence: [geometry](m1f-evidence/quote-geometry.json), [browser summaries](m1f-evidence/browser-summary.json), [desktop enterprise quote](m1f-evidence/desktop-enterprise-quote.png), [mobile long end](m1f-evidence/mobile-long-end.png), [mobile enterprise end](m1f-evidence/mobile-enterprise-end.png), [CID Forward preview](m1f-evidence/cid-forward-preview.png).

Remote fixtures generated **zero canary requests before opt-in**. Accepted remote regression generated exactly its allowlisted requests after explicit local opt-in, with no referrer. CID preview requests used only authenticated localhost message endpoints. No Maximum-update-depth, render-phase or ResizeObserver loop was observed. Detail/resource/autosave requests corresponded to user navigation, source preview, and save/close; normal session/health refresh remains.

Development-harness limitations are retained honestly: Next dev intermittently produced an empty/partial manifest error, as previously observed in M1E-C; the same isolated server was restarted, without a product workaround. Initial compilation/image-loading or navigation settlement occasionally outlasted the older harness's3-second probes; completed cases and successful settled reruns are recorded, not counted as a successful interrupted run. The initial 413 was a real compose defect and was fixed/tested as above. Production-build browser execution has no established authenticated local D1/R2 bridge and was not invented. Physical touch/keyboard, real iPhone safe-area and other browser engines were not tested.

## Tests and static validation

- **14 new pure quote tests PASS**: layout retention, text fallback, current+previous history, headers, repeated quotes, remote/CID/tracking image-only, malicious HTML/CSS/alt, unchanged editable policy and long/wide content.
- **6 new isolated local D1 tests PASS**: actual MIME→materialization→seed→autosave→reload→immutable revision/provider payload, both reply modes and Forward, canonical hash, no automatic attachments/send operation, long-body small update, stale version rejection, unrelated-actor denial and FK integrity.
- Existing CID D1 authorization/materialization regression: **19/19 PASS**.
- Focused unit/source-wiring suite: **236 tests:233 PASS /3 inherited source-regex failures**. Exact command is preserved in [unit-command.json](m1f-evidence/unit-command.json).
- Main TypeScript `node node_modules/typescript/bin/tsc --noEmit --incremental false`: PASS.
- Focused ESLint: zero errors; five warnings reproduced unchanged at accepted parent (unused flushSave/syncStateRef/buildAdminDirectSendIdempotencyKey, existing hook dependencies input.seed/persistDraft).
- Canonical locale generation: PASS; generated catalogs committed from source.
- `npm run build`: PASS in an isolated source copy with existing installed dependencies and only local dummy bindings. Initial build preparation encountered an incomplete older dependency copy; the existing complete installed dependencies were copied without installation/upgrade. Final canonical build passed. Existing middleware deprecation remains.
- `git diff --check`: PASS.

Focused D1 commands:

```sh
node --import tsx --test src/lib/mail/compose-quote-fidelity.integration.test.ts
node --import tsx --test src/lib/mail/cid-materialization.integration.test.ts
```

Named baseline debt, reproduced read-only on exact `4dc8cd1`:

1. `mail-desktop-ux-regression.test.ts` — “moves desktop attachment action to the bottom action bar”: stale literal `submitApproval` expectation.
2. `draft-management.test.ts` — “renders compose shell immediately with localized sender loading”: same stale `submitApproval` expectation.
3. `mail-compose-draft-final-regression.test.ts` — “sorts drafts by updated time descending on server and client”: expects `sortDraftsByRecency(items)` while current implementation uses `page.items`.

These tests were not weakened or deleted. The one updated layout-wiring assertion in `mail-compose-draft-reliability.test.ts` now matches the deliberately corrected expanded scroll region, with real geometry coverage above. Do not report the entire historical Mail suite as green.

## Remaining boundaries

Historical already-stripped HTML cannot be restored. CID preview authorization may fail safely if the original message is no longer accessible. Outgoing images remain descriptions, not reattached inline resources. No real email delivery or external-client pixel-perfect rendering was tested. No signature-system work, permission change, migration change, Production action or main merge occurred. Later integration/release remains separately authorized work.
