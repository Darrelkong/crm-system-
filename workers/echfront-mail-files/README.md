# echfront-mail-files — Public Download Worker (Phase 2C1 foundation)

This Worker implements the recipient-facing gateway foundation. It is not
deployed by the CRM application deployment and has no Production configuration
in this repository.

## Service Binding architecture (V1)

```
Customer browser
  → files.echfronthk.com/f/<token>   (warning landing page)
  → files.echfronthk.com/f/<token>/download (echfront-mail-files stream)
      → Service Binding → crm-system internal authorization RPC
          → D1 token hash lookup + lifecycle validation (CRM data plane)
      ← minimal authorized object reference only
  → private R2 stream (no presigned or permanent public URL)
```

## echfront-mail-files MUST NOT have

- Broad CRM D1 binding
- `BUSINESS_EMAIL` / outbound mail transport
- CRM user session authority
- Mail approval capabilities
- A client-supplied R2 key or bucket selector

## crm-system internal service owns

- Token hash lookup
- Status / recipient expiry / revocation validation
- Storage key + filename + mime + size resolution
- `download_count` / `last_downloaded_at` updates (V1)

## Public Worker owns

- `/f/<token>` HTTP surface
- `/f/<token>/download` authorized stream surface
- Generic invalid-link responses
- R2 HEAD/GET identity checks and streaming
- Safe download headers
- Edge rate limiting (future)

## Local development

`wrangler.echfront-mail-files.local.jsonc` uses a local-only Worker name,
local R2 namespace, and a service binding target named `crm-system-local`.
Run it with a local secret and a local CRM Worker when available:

```sh
npx wrangler dev \
  --config wrangler.echfront-mail-files.local.jsonc \
  --local \
  --var CRM_SYSTEM_GATEWAY_SECRET:replace-with-local-secret
```

The unit/E2E fixture injects the service binding and an in-memory R2 adapter;
it does not create Cloudflare resources.

Range requests are intentionally not implemented in V1. The gateway returns
the complete R2 body as a stream and uses `Accept-Ranges: none`.

Deploy isolation: **not** part of `npm run deploy` (crm-system).
