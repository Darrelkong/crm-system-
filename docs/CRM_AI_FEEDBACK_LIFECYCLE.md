# Customer AI feedback store lifecycle — F4G local evidence

2026-09-27. Local synthetic validation only; no Production access, deployment,
remote migration, Gemini generation, Mail send or permission change.

## Attribution

The same authenticated synthetic customer detail route was tested using separate
archives of main `a481689ad3854b85dfa6073c9aa495453659fb58`, F4D
`cb3f12ce6d150c902a115cab484c398b33c8dc06`, and F4E
`81e4a3fe1a149127bdbc330314ce08d1a20b68b3`.
All reproduced Maximum update depth exceeded before the insight GET completed,
with insightReady=false and no feedback controls/feedback GET. Environment:
Node 24.13.0, Next 16.2.9, webpack development mode with default StrictMode,
same in-app Chromium browser, same copied disposable synthetic local D1 fixture
(including additive 0091), same existing development authenticated session and
route `/customers/22222222-2222-2222-2222-222222222201`.
Only local DB bindings were configured; no AI/service/R2 bindings or remote data.

This is a BASELINE DEFECT. Main/F4 blobs are identical for:

- feedback client: `6cf9afac9ffd613efe827b8fdc3408e9eed2a406`
- feedback hook: `612deda83c35514b186cf39e4db0a16db002329e`
- feedback host: `8d7aae37b9ecb9901760c365c6d0c20815217474`

F4E's parent microtask scheduling changes GET setup/cancellation timing, but is
not necessary for this failure. An isolated hook, without that parent, reproduces
it. The parent scheduling and rating presentation are unchanged by this hotfix.

## Mechanism and fix

StrictMode replays effect cleanup/setup. The old cleanup permanently disposed
its store and cleared clientRef. The next render created a new client; the
previous client's dependency cleanup cleared the ref again. Each changed client
identity reran load; the not-ready branch called reset, which emitted a new
snapshot and prompted another render. An isolated test stopped at 102 attempted
renders, 49 used client instances and 50 load/reset/emits, with zero GET/PUT.
Disposed-store reuse also meant simply retaining the ref while still disposing
would incorrectly discard hydration results.

The mounted hook now retains its client with a lazy state initializer. Cleanup
invalidates pending GET/PUT sequence numbers without disposing or replacing the
store. useSyncExternalStore retains ownership of subscription cleanup. Terminal
dispose remains available for explicit client owners. No timer, render-count
workaround, reset semantics change, StrictMode removal or feature removal is
introduced in runtime code. getSnapshot was already stable between emits;
inline subscription identity was not the cause.

This fix has no dependency on human-rating runtime code and is independently
cherry-pickable onto the original main. No automatic main integration is approved.

## Reproduction and validation

Run `node scripts/test-ai-feedback-lifecycle.mjs`, then open its printed loopback
URL. The runner uses installed esbuild, React DOM and the actual hook/client in
StrictMode. Only translation and network fixtures are substituted. It needs no
CRM authentication bypass, database or provider. Assertions execute automatically,
report to the terminal and set exit status. The test-only render bound makes the
unfixed version fail promptly; it is not bundled into the application.

Twelve browser lifecycle scenarios passed: idle bounded behavior, false→true,
same-generation rerenders, generation change, 403, 404, failed GET/retry, explicit
rating PUT, explicit tag PUT, generation mismatch clear/reload, pending-load
unmount, and ready-at-mount StrictMode replay. Snapshot stability and subscription
cleanup are asserted. Idle rerenders produced no further load/reset/emits; one
active store was retained per mount. Expected development setup replay is bounded.

110 focused Node tests passed, covering the feedback client/API contract,
additional GET/PUT cancellation races, Customer AI panel/presentation, Timeline
Next Action, F4E rating presentation and customer-detail loading/perf contracts.
Main TypeScript, changed-file ESLint, npm run build and git diff --check passed.
Next's existing middleware deprecation warning remains.

Authenticated patched customer detail passed initial open, sustained idle,
navigate away/back and reload without browser/server update-depth errors. Rating
panel and Timeline remained visible. Empty/disabled AI state rendered normally;
cached generation behavior was tested with synthetic hook responses, not real AI.
Across initial open, re-entry and reload: 3 insight GETs (one per visit), zero
feedback-components GETs (no insight), zero unsolicited feedback PUTs. Browser
console errors: zero. No request storm.

F4F remains paused. Its broader mobile, stale, rating mutation, performance and
release gates were not resumed by F4G. This evidence does not authorize release.
