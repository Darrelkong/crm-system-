# echfront-mail-files — Public Download Worker (Phase 2A.1 skeleton)

Not deployed. See also `large-attachment-download-authorization.ts`.

## Service Binding architecture (V1)

```
Customer browser
  → files.echfronthk.com/f/<token>   (echfront-mail-files)
      → Service Binding → crm-system internal authorization RPC
          → D1 token hash lookup + lifecycle validation (CRM data plane)
      ← minimal authorized object reference only
  → short-lived private R2 GET (future)
```

## echfront-mail-files MUST NOT have

- Broad CRM D1 binding
- `BUSINESS_EMAIL` / outbound mail transport
- CRM user session authority
- Mail approval capabilities

## crm-system internal service owns

- Token hash lookup
- Status / recipient expiry / revocation validation
- Storage key + filename + mime + size resolution
- `download_count` / `last_downloaded_at` updates (V1)

## Public Worker owns

- `/f/<token>` HTTP surface
- Generic invalid-link responses
- Edge rate limiting (future)
- R2 download/presign boundary after authorization

Deploy isolation: **not** part of `npm run deploy` (crm-system).
