interface CloudflareEnv {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  LARGE_ATTACHMENTS?: R2Bucket;
  ASSETS: Fetcher;
  WORKER_SELF_REFERENCE: Fetcher;
  AI_SERVICE: Fetcher;
  AI_API_KEY?: string;
}
