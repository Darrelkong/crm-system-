interface CloudflareEnv {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  ASSETS: Fetcher;
  WORKER_SELF_REFERENCE: Fetcher;
}
