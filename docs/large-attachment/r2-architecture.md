# Large Attachment — Dedicated R2 Architecture (Phase 2A)

## Planned Production bucket

| Property | Value |
|---|---|
| Name | `crm-mail-large-attachments` |
| Privacy | **Private** — no public bucket URL |
| Custom domain on bucket | **No** — customer domain routes to download Worker only |

## Object key format

```
mail/large-attachments/YYYY/MM/<uuid>
```

- Server-generated UUID only
- No filename, email, customer id, or bearer token in key

## CORS (future, not configured in Phase 2A)

- Bucket-level CORS restricted to CRM web origins
- Methods: `PUT` (+ `HEAD` only if browser finalize requires it)
- **No** wildcard `*` origin in Production

## Lifecycle isolation

R2 lifecycle rules may serve as a **safety net** only. Canonical expiry timing comes from D1 lifecycle rows + cleanup jobs.

Existing bucket `crm-attachments` remains for:

- Direct outbound attachments (`mail/outbound-attachments/`)
- Inbound attachments / raw MIME / backups

Large attachments use a **dedicated bucket** to isolate CORS, cleanup blast radius, and operational accounting.

## Checksum verification (unresolved runtime detail)

`mail_stored_files.content_hash` remains SHA-256 of file bytes. Finalize must not treat R2 ETag as SHA-256 without proof. Phase 2B must choose:

- full server read hash for ≤100 MiB, or
- proven alternate checksum metadata if Cloudflare runtime documents equivalence

Phase 2A marks this as pending — see `large-attachment-storage.ts`.
