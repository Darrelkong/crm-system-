# Large Attachment — Presigned PUT Checksum (Phase 2B Contract)

Phase 2A.1 intentionally **does not** implement Production presigned PUT or choose checksum headers by assumption.

## Goal

Prove which R2/S3-compatible checksum enforcement path works with:

1. Browser-initiated PUT via short-lived presigned URL
2. Server finalize binding to authoritative R2 object identity (`storage_version`, `storage_etag`, exact size)
3. Client-declared `declared_content_hash` as revision fingerprint **without** claiming server-verified SHA-256 unless proof establishes equivalence

## Candidate order (must be validated experimentally)

1. **R2/S3 checksum enforcement signed with PUT** — preferred if supported by Workers signing path and browser upload
2. **Content-MD5** — only if compatible with selected browser hashing/upload approach
3. **Other documented R2-supported checksum header** — only after Cloudflare docs/runtime proof

## Explicit non-goals for Phase 2B proof

- Do **not** assume ETag equals SHA-256 `content_hash`
- Do **not** require crm-system to read entire 100 MiB object merely to compute SHA-256 at finalize
- Do **not** persist presigned PUT URLs or signing secrets in D1

## Success criteria for Phase 2B

- Documented header(s) accepted by R2 on presigned PUT
- Finalize captures matching authoritative metadata via HEAD/stat
- Mismatch between declared fingerprint and enforced checksum fails closed
- Integration test with local/miniflare or staging bucket (no Production mail send)

Status: **DEFERRED_TO_PHASE_2B_R2_PROOF**
