# Large Attachment Production Release Preparation

This document prepares repository release infrastructure only. It does not
deploy a Worker, migrate D1, create DNS, create credentials, change Access,
change CORS, enable a feature flag, or send email.

## Production Gateway source configuration

The canonical Gateway config is
`wrangler.echfronthk-mail-files.production.jsonc`.

- Worker: `echfront-mail-files`
- Entrypoint: `workers/echfront-mail-files/index.ts`
- Custom domain: `files.echfronthk.com`
- Private R2 binding: `LARGE_ATTACHMENTS` →
  `crm-mail-large-attachments`
- Service binding: `CRM_SYSTEM` → `crm-system`
- Required Worker secret: `CRM_SYSTEM_GATEWAY_SECRET`
- Internal authorization path:
  `/api/internal/mail/large-attachment/download-gateway`
- Internal secret header:
  `X-Crm-Large-Attachment-Gateway-Secret`

The Gateway has no D1 binding and accepts no client-supplied bucket or R2 key.
The R2 bucket must remain private; recipient access is only through
`files.echfronthk.com`.

The `custom_domain` route is source configuration for the future Wrangler
deployment. Wrangler requests the custom domain during deployment, but the
Cloudflare zone, DNS/SSL readiness, account permissions, and final hostname
verification remain a later Cloudflare control-plane action. No domain is
created in Phase A.

The Gateway must fail closed when `CRM_SYSTEM_GATEWAY_SECRET`,
`CRM_SYSTEM`, or `LARGE_ATTACHMENTS` is unavailable. Missing or invalid
authorization must never expose an object.

The canonical guarded command is:

`npm run deploy:mail-files:production`

It validates the clean `main` source against `origin/main`, validates the
Production config, verifies the required Gateway secret name through Wrangler
metadata, and only then invokes Wrangler with the Production config. The
secret value is never read into source or committed.

## Access and presign secret requirements

`files.echfronthk.com` MUST NOT be protected by Cloudflare Access OTP.
`crm.echfronthk.com` remains protected as currently configured. Recipient
authentication is the strong opaque capability token plus Gateway
authorization.

Before enabling Production large-attachment runtime behavior, configure these
CRM Worker secrets externally:

- `R2_LARGE_ATTACHMENT_ACCESS_KEY_ID`
- `R2_LARGE_ATTACHMENT_SECRET_ACCESS_KEY`
- `CLOUDFLARE_ACCOUNT_ID`

They must be Cloudflare Worker secrets, never committed, bucket-scoped, limited
to `crm-mail-large-attachments`, and granted only Object Read & Write. Phase A
does not create or validate credential values.

Repository Production defaults remain:

- `MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED=false`
- `MAIL_LARGE_ATTACHMENT_SEND_ENABLED=false`
- `MAIL_LARGE_ATTACHMENT_PUBLIC_BASE_URL=https://files.echfronthk.com`

The updated `crm-system-mail-jobs-cron` retains delivery-token cleanup. Its
canonical command remains `npm run cron:mail:deploy`. No Worker or scheduler is
introduced by this release preparation.

## Future R2 CORS configuration

Apply only during the future Production release, after the private bucket and
credentials have been verified. This exact payload removes localhost and
allows only the CRM origin:

```json
[
  {
    "AllowedOrigins": ["https://crm.echfronthk.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": [
      "Content-Type",
      "x-amz-checksum-sha256",
      "Content-MD5",
      "If-None-Match"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Phase A does not apply this payload.

## Token-safe observability and rate-limit plan

Do not intentionally log `/f/<raw-token>`, a full recipient URL, a raw token,
an R2 key, a request body, or document bytes.

Retain only request ID, route class, HTTP status, latency, and a generic error
category. This is a release checklist item; Cloudflare observability is not
changed in Phase A.

Proposed future monitoring and enforcement:

- Warning route `/f/*`: monitor above 120 requests per IP per 10 minutes.
- Download route `/f/*/download`: monitor above 30 requests per IP per
  10 minutes; block only above 60 requests per IP per 10 minutes.
- Token-level where supported: approximately 10 downloads per token per
  10 minutes.

No WAF or rate-limit rule is created in Phase A.

## Read-only precheck and validation commands

The repository-only precheck is:

`npm run mail:large-attachment:production-precheck`

It checks source state, required files, Gateway bindings, disabled flags,
additive migrations, and local/test configuration leakage. It performs no
deployment, migration, secret, DNS, Access, CORS, or Cloudflare mutation.
`MAIL_RELEASE_EXPECTED_SHA` may be supplied when an exact release source SHA
must be asserted.

Future local validation commands are:

`npx --no-install wrangler deploy --dry-run --config wrangler.echfronthk-mail-files.production.jsonc --outdir .mail-files-production-dry-run`

`npm run cron:mail:dry-run`

The first command is a Wrangler dry-run only; neither command deploys.

## Future Production release order

Do not execute this order during Phase A:

1. Verify feature/main ancestry.
2. Fast-forward `main`.
3. Create a Production D1 backup.
4. Run a temporary-copy dry-run for migrations 0074 and 0075.
5. Apply Production migration 0074.
6. Run the Production integrity check.
7. Apply Production migration 0075.
8. Run the Production integrity check.
9. Deploy CRM with runtime=false and send=false.
10. Deploy Mail Jobs.
11. Deploy the Gateway with `npm run deploy:mail-files:production`.
12. Configure `CRM_SYSTEM_GATEWAY_SECRET` for the Gateway.
13. Verify the `CRM_SYSTEM` Service Binding targets `crm-system`.
14. Configure and verify `files.echfronthk.com`.
15. Verify the Cloudflare Access exclusion for `files.echfronthk.com`.
16. Create least-privilege, bucket-scoped R2 credentials.
17. Set the CRM presign secrets.
18. Update Production R2 CORS to the payload above.
19. Configure token-safe logging and the proposed rate limits.
20. Run the infrastructure health check.
21. Enable runtime=true while keeping send=false.
22. Run an Admin upload/download test.
23. Run one controlled real-email test.
24. Enable send=true.
25. Run a second controlled email test.
26. Monitor the rollout.

If rollback is required, stop outbound sending first, return the CRM runtime
and send flags to false, stop Mail Jobs/Gateway changes as applicable, preserve
the D1/R2 evidence, and use the pre-release Worker/config revision. Never
delete delivery-token or lifecycle data as a rollback shortcut.
