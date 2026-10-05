# M2A — Corporate signature domain and durable contract

Local implementation and validation: 2026-10-05. Base M1 frozen source:
`4beb5ffef5731cf66a39f8c5f2c67bdd5ec6a4f1` on
`fix/mail-mobile-reader-continuity`. M1 remains complete. M2 is not complete.
No commit, Preview change, Production access, remote migration, deployment or send.

## Product and domain contract

One logical ECHFRONT master-template lineage; identity comes exclusively from
the selected authorized Sender Identity, never the actor, mailbox owner or draft
author. Personal/corporate type is explicit. Existing address/display_name are
reused; optional title and phone are not invented. A corporate display name such
as ECHFRONT Client Services is supported without a personal-name assumption.

`corporate-signature-domain.ts` defines strictly validated template content,
version identity, profile and deterministic text/controlled HTML. The exact
approved V1 legal paragraphs and ordering are independently asserted in tests.
The legal company name appears only in the smaller/lighter footer. No UI locale
rewrites outgoing legal text. Canonical V1 is a frozen domain fixture, not an
active-template fallback or database seed.

Text values reject markup, control/format characters and excessive lengths;
normalization is NFC, trim and repeated ASCII-space collapse. Optional empty
strings/null omit their lines. Quotes/ampersands are HTML-escaped. Invalid HTML
inputs are rejected rather than stripped into a different identity. Even literal
`javascript:` is only inert text: V1 generates no links, assets, remote resources,
classes, arbitrary CSS or HTML. Fixed email-compatible inline presentation is
owned by rendering contract `echfront-corporate-v1`. No M1 sanitizer relaxation.

The renderer has no database/environment/actor dependency and returns rendered
text/HTML plus template ID/number and profile revision. It does not authorize
Send-As: future callers must supply the authorized identity. Explicit historical
versions remain renderable. The future generation entry point rejects absent or
inactive templates and unconfigured/invalid profiles with `CONFIGURATION_ERROR`;
it does not fall back to empty, legacy or another person's signature.

## Additive schema — 0093

`0093_mail_corporate_signature_domain.sql` is the only new migration after 0092.

- `mail_corporate_signature_template_versions`: fixed `echfront` scope, unique
  positive version number, rendering contract, nine durable plain-text content
  fields, active flag and creation/activation/retirement attribution. A partial
  unique index permits at most one active version. Content/version identity and
  creation time are immutable by SQL trigger; deletion is blocked. BEFORE INSERT
  collision guards prevent replacement by ID, lineage/version or active-version
  conflict; a lifecycle UPDATE guard also prevents active-row eviction. These
  guards do not depend on recursive_triggers. Valid lifecycle changes remain
  possible. No arbitrary HTML/CSS payload column exists.
- Sender Identity gains nullable signature type/title/phone and revision `0`
  by default. Historical identities remain unconfigured; no heuristic backfill.
  SQL rejects invalid types, noninteger/negative and decreasing revisions.
  M2B must atomically increment with expected-revision CAS for every relevant
  profile, display-name or address edit. M2A provides the safe increment primitive
  but does not implement mutation services or change existing identity edits.
- Snapshot gains nullable corporate-template FK and profile revision. Add-column
  CHECKs safely enforce mutually exclusive legacy/corporate provenance and
  require a positive profile revision for corporate provenance. Historical
  NULL/no-source snapshots remain valid. Domain validation mirrors these checks.

No existing table rebuild, old-row update, hash change, asset rewrite or seed.
The corporate table has **zero rows and no active template** after migration.
The existing composite identity/version FK and revision/snapshot FK are retained.
No fake legacy signature-version row represents a corporate template.

The current application/schema types include the new columns, so any future
deployment of this source needs 0093 first. Old code remains compatible after the
additive migration. This note is not release or migration authorization.

## Local validation evidence

| Check | Result |
| --- | --- |
| Corporate domain units | 24/24 PASS |
| Domain + existing sanitizer/policy/compose authorization/send-as units | 50/50 PASS total (includes those 24) |
| Fresh chain, populated 0092 → 0093 and replacement immutability | 46/46 PASS after repair, four independent disposable local D1 environments |
| Existing draft/outbound revision integration | Prior 17/17 PASS; not rerun in SQL-trigger repair |
| Legacy sender/signature integration | Prior 2/13 PASS; 11 baseline-confirmed inherited failures, unchanged and not rerun in repair |
| TypeScript noEmit | PASS |
| Scoped ESLint | PASS, zero errors/warnings |
| Production build | Prior PASS in separate disposable build copy; application runtime/schema source unchanged by repair. No rebuild for SQL/test/docs-only correction |
| git diff --check | PASS |

Migration tests verify 92 → 93 tracking rows; no active corporate seed; existing
identity/signature/snapshot/revision/asset rows preserved by comparison of every
pre-existing column; FK and quick checks clean; template version/active uniqueness,
append-only history, type/revision checks, legacy composite FK, corporate FK,
mixed/partial provenance rejection on insert/update, and final revision lineage.
Full integrity_check passes against closed disposable SQLite read-only because
the D1 API disallows that PRAGMA. The new fixtures contain disabled synthetic
credentials and metadata only, with no live R2 access.

Commands: `node --import tsx --test` for the focused units and migration test;
`node scripts/test-mail-d1-serial.mjs` for service integration;
`tsc --noEmit --incremental false`, scoped `eslint`, `git diff --check`;
`npm run build` only in `/var/folders/4q/8s0trbh12bs9lmchml8qhkxw0000gn/T/crm-m2a-build-dk89eebv`.
All D1 commands are `--local` with disposable persistence. No existing Preview
database is a test resource. Existing test gateway is local with fake transports.

### Replacement immutability defect loop — 2026-10-05

Engineering acceptance found that the original UPDATE/DELETE triggers did not
prevent `INSERT OR REPLACE` from replacing a historical version with changed
content under the same ID when recursive_triggers was OFF. The corporate snapshot
FK still resolved and FK checks remained clean. The original 10 migration checks
therefore did not establish complete append-only behavior; acceptance was blocked.

The authorized repair modifies unapplied 0093 directly (no 0094). BEFORE INSERT
now raises ABORT on any existing ID, same scope/version, or active-in-scope conflict,
before SQLite replacement can delete a row. It does not rely on UNIQUE conflict
policy or connection PRAGMAs. BEFORE UPDATE OF is_active also rejects activation
that could evict another active row via UPDATE OR REPLACE. Existing canonical
UPDATE/DELETE guards remain. No historical table rebuild, migration seed,
runtime cutover, authorization or UI change was introduced.

Fresh local validation: 46 migration tests passed, including 17 focused cases
under each explicitly verified recursive_triggers setting (0 and 1), their two
parent tests, and the existing 10 migration tests. Write predicates verify the
requested PRAGMA inside each attempted operation, not only in an earlier request.
Coverage includes same-ID, same-version/different-ID, active-version conflicts,
REPLACE INTO, ordinary INSERT conflict policies, UPSERT DO NOTHING/DO UPDATE,
retired-version replacement and UPDATE OR REPLACE activation. Every rejected
attempt compares all template columns/row counts, all snapshot fields and the
resolved corporate-template FK target, and checks foreign_key_check. Normal V2
insertion and deactivate/retire-V1 then activate-V2 operations succeed while
preserving all non-lifecycle content and snapshot bodies/hashes.

Corrected fresh/populated migration paths preserve legacy identities, versions,
version assets, snapshots, snapshot assets and outbound revision fields/hashes.
FK/quick checks and closed-local-SQLite integrity checks pass. Focused units
50/50 (including M2A domain 24/24) were rerun unchanged. TypeScript noEmit, scoped
ESLint and diff integrity pass after explicit result types were added to the new
test helpers. No browser/build claim is used to prove SQL correctness.

Repair evidence logs are local only: `/tmp/m2a-replacement-migration.log`,
`/tmp/m2a-replacement-units.log`, `/tmp/m2a-replacement-tsc-final.log` and
`/tmp/m2a-replacement-eslint-final.log`. No Production application, Preview change,
commit/push or M2B start. Replacement defect is fixed locally; engineering
re-acceptance is the next gate, not automatically granted by this record.

### Retained inherited test debt

`sender-identity-signature.integration.test.ts` had an obsolete direct local D1
connection. It now uses the existing isolated gateway helper, with no assertion
change. After that infrastructure correction, 11 failures reproduce identically
on the frozen M1 source in a separate archive (same connection-helper adaptation):

1. same-text receiving/sender identity;
2. send without exact identity grant;
3. exact grant / super-admin negative;
4. identity-grant isolation;
5. suspended identity;
6. reserved-system identity;
7. text signature versions;
8. sanitized rich HTML;
9. empty sanitized HTML;
10. stored signature asset;
11. global-read-only identity-management negative.

Cases 1–10 fail before their assertion because their personal-mailbox fixtures
omit required `ownerUserId`. Case 11 supplies a CRM Admin, whose management
authority contradicts the stale expected denial. Baseline/current: identical
13 outcomes (2 pass, 11 fail). These are not M2A regressions; assertions were not
weakened and stale fixtures were not rewritten. The overall suite is not all green.
Current negative authorization units and the 17 revision integration checks pass.

During preparation, the new migration harness required a larger Wrangler-output
buffer, the established `state/v3` proxy path and read-only closed-SQLite integrity
check; a synthetic asset hash was corrected to the existing 64-hex contract.
These test-setup errors were resolved before the reported passing run.

## Intentionally not wired / remaining packages

No Admin/profile UI, publication service, My Corporate Signature, Compose preview,
approval-pane rendering, snapshot/outbound/direct-send cutover or Reply/Forward
integration. Existing signature services, revision hashing and send assembly are
unchanged. M2B will own permissioned configuration/publication and profile CAS;
later integration must capture/render exact immutable template/profile provenance
and handle stale previews. No M2B, M3 or M4 work is included here.

Engineering disposition after the replacement repair: M2A ready for engineering re-acceptance, with the
baseline-confirmed integration-test debt documented. No browser UX claim is made
for this domain-only package. Local tests do not establish deployed behavior.
