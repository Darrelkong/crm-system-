# Privacy overlay F2 — local evidence (2026-09-27)

## Current integration status — 2026-09-30

F2 is implemented and accepted locally; the exact reviewed privacy styling is retained.

Included in [Integration 1B](CRM_INTEGRATION_1B.md), candidate only. **NOT
PRODUCTION DEPLOYED. Integration 1C validation is PENDING.** Historical standalone
branch/base statements and test evidence below remain preserved; integration does
not retroactively turn those tests into cross-feature validation.

## Standalone origin and historical evidence

Status: implementation and local validation complete; NOT Production deployed.
Base: remote main `a481689ad3854b85dfa6073c9aa495453659fb58`.
Branch: `fix/privacy-overlay-consistency`. No F1 or Smart Ingest 2 ancestry.

## Diagnosis

The shared dashboard `GlobalPrivacyScreen` is responsible for the centered logo,
full viewport mask, hidden/pagehide handling and desktop (>=1024px) 120-second
visual idle screen. It is distinct from CRM idle logout and Access. Activity
restores the idle screen; mobile uses the same component for hidden lifecycle
masking, not the desktop idle timer. This behavior remains unchanged.

All available Git history for this component leads to its introduction in
`216ce02e3a1b33c8a863681bdd64548173854aa8` (remote
`fix/recovery-health-2026-08-27`). Its CSS is identical to main's privacy rules:
18% dark background, 22px blur, 24% dark-theme background. No separate preferred
TEST implementation was identified in available branch history or the existing
stash. No claim is made that a particular user's browser/Production build was
inspected or that this is the sole cause of their visual observation.

A concrete development/production difference IS reproduced: the installed
Lightning CSS optimizer collapses adjacent `backdrop-filter` and
`-webkit-backdrop-filter` aliases to the last declaration. Main puts the prefixed
one last. The existing production-mode build also contains only the prefixed
property. In local Chromium, the optimized main rules compute `backdrop-filter:
none`: the synthetic text remains readable through a grey tint. This is not a
Windows-only failure. The source declarations alone do not prove built behavior.

## Scope of fix

Only privacy CSS changes at runtime. Independent `@supports` blocks retain both
standard and prefixed blur declarations in optimized output. Supported browsers
use 28px blur and a 22% light neutral tint (dark theme 24% dark tint). The default
is opaque; unsupported blur cannot reveal text. Reduced-transparency uses an
opaque background, and forced colors uses Canvas/CanvasText without disabling
system color adjustment. There are no fade-in transitions.

The existing logo stays centered. A low-opacity, decorative repeating domain
watermark is painted on the overlay. The existing authenticated identity/time
security watermark remains unchanged beneath it. No data is duplicated into
this decorative pattern.

No component/lifecycle/session/auth/permission code changed. Pointer interception
remains `pointer-events: auto`; existing activity-to-dismiss behavior is retained.
This presentation layer is not an authentication lock, DOM removal, screen-reader
privacy boundary, or substitute for server authorization.

## Executed validation

- `node --import tsx --test src/components/security/watermark.test.ts src/components/privacy/global-privacy-screen.test.ts src/lib/auth/idle-timeout-check.test.ts src/lib/auth/client-security.test.ts`: **52 PASS / 0 FAIL**.
- `./node_modules/.bin/tsc --noEmit`: PASS.
- `./node_modules/.bin/eslint src/components/privacy/global-privacy-screen.test.ts`: PASS.
- `npm run build`: PASS (Next.js production build; no deployment). Existing middleware deprecation warning remains unrelated.
- `git diff --check`: PASS.

New tests exercise the actual installed CSS optimizer and assert both blur
paths survive, opaque fallback/accessibility behavior, full viewport positioning,
no transition, shared responsive styling, logo/domain presence and pointer
interception. The initial new test used case-sensitive `Canvas`, while the
optimizer correctly lowercases it; corrected the assertion, not runtime behavior.

Local browser fixture uses the real React component and the final Next production
CSS with synthetic customer name, telephone, notes and follow-up text. Hidden
visibility events are simulated in this disposable fixture, without logging into
CRM, changing timers in production source, or using customer data.

| Check | Evidence |
| --- | --- |
| 1280x900 | Computed blur 28px; full viewport bounds; centered branding; no horizontal overflow; underlying synthetic text visually unreadable. |
| 390x844 | Same blur and component; centered branding; no horizontal overflow; underlying text unreadable. |
| Rerender/reload | Rerender preserves active mask; reload followed by activation uses the same compiled styles. |
| Input | Covered pointer hit resolves to privacy overlay; protected action count remains zero. Keyboard/activity dismissal semantics are unchanged, not newly converted into a lock. |
| Unsupported blur | Fixture removes blur feature blocks: opaque rgb(229,234,240), no protected content visible. |
| Reduced transparency | Fixture enables the actual preference block: opaque background and no blur. |
| Dark theme | 28px blur, expected 24% dark tint; protected text unreadable. |
| Activation | No CSS fade/transition; observed active render already blurred. Frame-perfect OS app-switch snapshots were not tested. |

Native Windows/Safari/iOS device execution and actual OS forced-colors settings
were NOT performed. Their CSS support/fallback branches are checked, not reported
as native-device test passes. The preferred historical test screenshot/build
identity remains unknown. Synthetic fixture and screenshots are temporary local
artifacts under `/tmp/crm-f2-visual`, `/tmp/crm-f2-desktop.png`, and
`/tmp/crm-f2-mobile.png`.

## Boundaries

No Production or Cloudflare access/change, no deployment, no migration/schema,
no Mail, no F1, no Smart Ingest, no website work. Main unchanged. Existing session
idle timeout, seven-day absolute ceiling, revocation/device controls and protected
data permissions are unchanged. Release requires separate approval.
