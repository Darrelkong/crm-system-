# ECHFRONT Mail — Canonical Content Hash v1

**Status:** Final contract (Phase 2B.9.1) — specification only; no production hash service yet.

## Purpose

Canonical Content Hash v1 answers:

> What exact approval-relevant outbound content does this revision represent?

Future Mail Approval binds to:

1. An immutable outbound revision identity
2. That revision's Canonical Content Hash

A new outbound revision is required whenever approval-relevant outbound content changes. Old revisions and their hashes remain immutable.

This hash is **semantic approval content**, not:

- a raw SMTP/MIME byte hash
- a database-row hash
- a transport hash
- a CRM customer-association hash

## Version

| Field | Value |
|---|---|
| `hash_version` | `1` |
| Domain label | `ECHFRONT-MAIL-CONTENT-V1` |

The canonical payload is self-describing. Top-level metadata includes:

- `domain`: `ECHFRONT-MAIL-CONTENT-V1` (exact, no surrounding whitespace)
- `hash_version`: `1`

The database revision field `hash_version = 1` must correspond to the canonical payload version. Changing `hash_version` changes the hash.

The domain label **must** appear in the canonical payload so future hash domains cannot collide accidentally.

## Top-level v1 inputs

Canonical Content Hash v1 includes exactly these semantic sections:

1. `hash_version`
2. `domain`
3. `sender`
4. `subject`
5. `body`
6. `sensitivity`
7. `compose_mode`
8. `recipients`
9. `signature`
10. `attachments`

No other revision fields enter v1 unless explicitly listed in this document.

## Sender

**Include:**

- `from_address`
- `from_display_name`

**Exclude:**

- `sender_identity_id`
- `mailbox_id`
- database row IDs

Internal DB identifiers are authorization/provenance context, not externally represented message content. The revision creation service must verify that the chosen Sender Identity address equals the snapshotted `from_address`. Approval remains bound to the immutable revision entity itself.

## Email address normalization

One deterministic V1 rule for all email addresses (`from_address`, recipient `address`):

1. Trim surrounding whitespace
2. Unicode NFC
3. Lowercase the entire address

This matches existing case-insensitive address semantics and `lower(address)` uniqueness rules.

**Do not** perform provider-specific rewriting (no Gmail dot removal, no plus-address stripping, no alias rewriting).

## Display name normalization

For `from_display_name` and recipient `display_name`:

1. `NULL` → `""`
2. Unicode NFC

Do not trim meaningful internal/edge spaces unless service validation already forbids them.

## Subject

Subject is required/nonblank at the Revision level. Canonical hash includes the exact snapshotted subject after:

1. Unicode NFC
2. CRLF / CR newline normalization to LF (if any newline unexpectedly exists)

**Do not trim** the subject. `"Hello"` and `"Hello "` remain different canonical content.

## Body

Include both:

- `body_text`
- `body_html_sanitized`

Nullable body representation: `NULL` → `""`

String normalization:

1. Unicode NFC
2. CRLF → LF
3. Lone CR → LF

**Do not:**

- parse or re-render HTML
- reorder attributes
- collapse whitespace
- beautify or minify HTML

The sanitized immutable HTML string itself is canonical content.

## Sensitivity

Include exact enum value:

- `normal`
- `sensitive`
- `restricted`

Changing sensitivity produces a different v1 content hash.

## Compose mode

Include exact enum:

- `new`
- `reply`
- `reply_all`
- `forward`

Changing `compose_mode` changes the hash.

**Exclude** `reply_to_message_id`. That is internal revision/threading provenance. Approval remains bound to the immutable Revision entity, not to a separate threading pointer in the hash payload.

## Recipients

Include **all** To, Cc, and Bcc recipients.

Each canonical recipient object:

```json
{
  "type": "to | cc | bcc",
  "address": "<normalized address>",
  "display_name": "<normalized display name>"
}
```

Bcc is security-sensitive but **must** participate in the hash. Do not expose Bcc through unauthorized APIs merely because the hash service can read it.

### Recipient ordering

Recipient UI/input ordering must not cause meaningless hash changes. Canonicalize recipients as a semantic set.

Sort by:

1. Recipient type order: `to`, then `cc`, then `bcc`
2. Normalized `address` ascending
3. Normalized `display_name` ascending (tie-breaker)

Do not hash recipient database IDs or recipient `sort_order`.

Moving an address between types (To → Cc, Cc → Bcc, etc.) **must** change the hash.

## Signature

Do **not** hash:

- `signature_snapshot_id`
- `source_signature_version_id`
- internal DB row IDs
- storage keys

Do **not** rely solely on an existing `snapshot_hash` field as the approval content source.

Canonical Content Hash v1 derives from the actual immutable Signature Snapshot content.

Include:

- `body_text`
- `body_html_sanitized`
- immutable signature snapshot asset set

Signature body strings use the same `NULL` → `""`, NFC, and newline normalization rules as message body.

### Signature assets

Each canonical Signature Snapshot Asset contains **exactly**:

- `asset_ref`
- `content_hash`
- `mime_type`
- `size_bytes`

**Exclude:**

- `sort_order` (ordering mechanic, not semantic content)
- `stored_file_id`
- `storage_provider`
- `storage_bucket`
- `storage_key`
- asset database row id

Normalization:

- `asset_ref` → NFC
- `mime_type` → trim + lowercase ASCII

Signature assets are a deterministic semantic set. Sort by:

1. `asset_ref` ascending
2. `content_hash` ascending
3. `mime_type` ascending
4. `size_bytes` ascending

Changing only Signature Asset DB `sort_order` must **not** change the hash. Changing `asset_ref`, `content_hash`, `mime_type`, or `size_bytes` must affect the canonical semantic object.

Duplicate semantic asset rows remain separate array entries.

## Attachments

Each canonical attachment object contains **exactly**:

- `content_hash`
- `display_filename`
- `mime_type`
- `size_bytes`
- `delivery_mode`
- `secure_expiry_days`

**Exclude:**

- `sort_order` (ordering mechanic, not serialized canonical content)
- `stored_file_id`
- attachment row id
- storage provider / bucket / key
- `created_by`
- security scan status
- `original_filename` when it is only historical metadata

This preserves migration 0055:

- `STORED_FILE_ID`: **not** hash input
- `CONTENT_HASH`: **hash input**

### Attachment ordering

Revision attachment `sort_order` is used **only** to establish relative canonical array order. After ordering is resolved, `sort_order` is **not** serialized into canonical attachment objects.

Examples:

- A.pdf `sort_order = 1`, B.pdf `sort_order = 2` and A.pdf `sort_order = 10`, B.pdf `sort_order = 20` → **same hash** (relative order unchanged)
- A then B vs B then A → **different hash** (array position expresses relative ordering)

For deterministic ties when `sort_order` values collide, use semantic tie-breakers:

1. `content_hash` ascending
2. `display_filename` ascending
3. `mime_type` ascending
4. `size_bytes` ascending
5. `delivery_mode` ascending
6. `secure_expiry_days` with `null` before integers

Do not use DB row IDs as tie-breakers.

**Do not deduplicate** identical attachment entries. Multiplicity matters.

### Attachment normalization

| Field | Rule |
|---|---|
| `display_filename` | Unicode NFC; preserve meaningful content |
| `mime_type` | trim + lowercase ASCII |
| `content_hash` | exact lowercase 64-char SHA-256 hex |
| `size_bytes` | integer |
| `delivery_mode` | exact enum |
| `secure_expiry_days` | `direct_attachment` → canonical `null`; `secure_file` → integer `1`, `3`, or `7` |

## Secure file operational artifact boundary

For `delivery_mode = secure_file`, canonical approval semantics include:

- file `content_hash`
- `display_filename`
- `mime_type`
- `size_bytes`
- `delivery_mode = secure_file`
- `secure_expiry_days` = `1`, `3`, or `7`

Canonical Hash v1 explicitly **excludes** future generated operational/delivery artifacts:

- download token
- access token
- signed token
- download URL
- signed URL
- presigned URL
- storage URL
- access session id
- absolute `expires_at` timestamp
- download audit records

These are generated operational/delivery artifacts after approval. They are **not** manually approved outbound semantic content.

Approval approves **which file** + **how it is delivered** + **expiry policy** — not the ephemeral secret/token used to implement delivery.

### Future Secure File user-visible system copy

If future Secure File implementation introduces mutable user-visible system-generated copy/template that is approval-relevant, it must either:

**A.** be represented in Canonical Content Hash input, or

**B.** require a new Canonical Hash version

It must **not** silently change under Content Hash v1 if it materially changes approval-relevant displayed content.

No Secure File implementation is defined in this phase.

## Customer association (explicitly excluded)

The following do **not** affect Canonical Content Hash v1:

- `customer_id`
- `customer_association_type`
- `customer_associated_by_user_id`
- `customer_associated_at`

CRM association is internal metadata frozen on the Revision for history but does not change external outbound content.

## Other excluded fields

Also excluded from v1:

- revision id, `revision_chain_id`, `revision_number`, `parent_revision_id`
- `revision_kind`, `source_draft_id`
- `mailbox_id`, `sender_identity_id`
- `created_by_user_id`, `created_at`
- `signature_snapshot_id`, signature snapshot DB id
- all attachment/store DB IDs
- original physical storage location
- scan state, approval state, send state, delivery state
- transport/provider ids
- audit timestamps

These may matter to authorization/audit but are not Canonical Content Hash v1 inputs.

## Canonical data types

The canonical payload may contain only:

- object
- array
- string
- integer
- null

No floating point, `undefined`, `Date`, binary blobs, or booleans (unless a future version explicitly adds them). All timestamps are excluded from v1.

## Deterministic JSON serialization

ECHFRONT deterministic JSON subset:

- UTF-8 encoding
- Object keys serialized in ascending ASCII key order (recursive)
- Arrays preserve canonical order defined by this contract
- Strings use normal JSON escaping
- Integers use base-10 JSON integer representation
- `null` serializes exactly as JSON `null`
- No insignificant whitespace
- No pretty-printing

Do not rely on object insertion order.

## Hash computation

Canonical payload includes:

```json
{
  "domain": "ECHFRONT-MAIL-CONTENT-V1",
  "hash_version": 1,
  ...
}
```

Steps:

1. Build canonical semantic object
2. Normalize all strings/arrays
3. Deterministic JSON serialize
4. UTF-8 encode
5. SHA-256
6. Lowercase hexadecimal output

Expected final hash: exactly **64 lowercase hex characters**.

## NULL / empty contract

| Field | Equivalence |
|---|---|
| `from_display_name` | `NULL` == `""` |
| recipient `display_name` | `NULL` == `""` |
| `body_text` | `NULL` == `""` |
| `body_html_sanitized` | `NULL` == `""` |
| signature `body_text` | `NULL` == `""` |
| signature `body_html_sanitized` | `NULL` == `""` |
| `secure_expiry_days` | `null` is semantically distinct from integer values |

Do not globally convert every `NULL` to empty string.

## Golden vectors

Synthetic fixtures and expected hashes live in:

- `src/lib/mail/canonical-content-hash-v1-contract.ts` (test-local canonicalizer)
- `src/lib/mail/canonical-content-hash-v1-golden-vectors.test.ts`

| Vector | Behavior | Expected hash |
|---|---|---|
| V1 | Basic message → deterministic hash | `a97d8e2ae050864fa3bbfd720172712c477136e476517ccbaa45557bacb994ad` |
| V2 | Recipient UI order change → **same** as V1 | `a97d8e2ae050864fa3bbfd720172712c477136e476517ccbaa45557bacb994ad` |
| V3 | Recipient To → Bcc → **different** | `cd26e6505d7a21bdba54d619eccc0fadfaebac4ac0adce1005883f054cbf2ce5` |
| V4 | Same attachment semantics, different `stored_file_id` → **same** as V1 | `a97d8e2ae050864fa3bbfd720172712c477136e476517ccbaa45557bacb994ad` |
| V5 | `display_filename` changed → **different** | `73e358b45b6b82d4d029fc650edc25308129e373c36743a87565ce1d3b0e5dff` |
| V6 | Secure expiry 7 → 3 → **different** | `77725fdcbd0c29c4af29e54df72f929e53a25d6199db6a41ecf44321bf744d1a` / `3c35db59287baef149a7aa1231b548e7e59034cf2a2503499141e70d422c6a09` |
| V7 | Signature asset `content_hash` changed → **different** | `0033191c968267fcacc400834484970ece143cf21a59da13c93600476b227520` |
| V8 | CRM customer association changed only → **same** as V1 | `a97d8e2ae050864fa3bbfd720172712c477136e476517ccbaa45557bacb994ad` |
| V9 | `body_html_sanitized` NULL vs `""` → **same** | `a1909ce9c20579cdab5c5db9654837bf16b6fb5a746d54397447569b890159c6` |
| V10 | CRLF vs LF body text → **same** | `e6cbf7520af607757f100f15586db90229425d067398853651667d7922bd95c7` |
| V11 | Unicode NFC-equivalent text → **same** | `6d4a929bcc6c5ae1274610cc9aba02d62b534c793a7a162516f51a8ace350c50` |
| V12 | Bcc recipient change → **different** | `1e9268ee4e562bc8b2cd7b1e1d480e6ed1fabc28850be2d357475bcd568fc765` |
| V13 | Same relative attachment order, different raw `sort_order` → **same** | `5f5ccb5a1fa84fe1c88deaa01207baf15a5492dcde04182ff16a0318703d08fb` |
| V14 | Reversed attachment relative order → **different** | `5d706e262d563e268c1d2c59fe52e13ab8252740e13f1629269003c0b8b40df2` |
| V15 | Signature asset raw `sort_order` only → **same** | `6d9145d0062494531788f45ee2a6fbe67997a1f8696ab6b550556300e08223b0` |
| V16 | Object key insertion order → **same** JSON and hash as V1 | `a97d8e2ae050864fa3bbfd720172712c477136e476517ccbaa45557bacb994ad` |
| V17 | `hash_version` included; synthetic version change → **different** | payload contains `hash_version: 1` |

## Implementation boundary

Phase 2B.9 / 2B.9.1 provide:

- This contract document
- A **test-local** canonicalizer for golden-vector verification only

Phase 2B.9 / 2B.9.1 do **not** provide:

- Production Mail hash service
- Draft / Revision / Approval / Send integration
- API routes

Wait for Admin review before implementing the production service.
