/**
 * Future dedicated download Worker environment contract (not deployed).
 */
export type EchfrontMailFilesEnv = {
  /** Private bucket: crm-mail-large-attachments */
  LARGE_ATTACHMENTS: R2Bucket;
  /** Optional minimal D1 binding or service fetch for token verification — TBD in Phase 2B. */
  DB?: D1Database;
};

export const ECHFRONT_MAIL_FILES_WORKER_NAME = "echfront-mail-files" as const;

export const ECHFRONT_MAIL_FILES_PUBLIC_HOST = "files.echfronthk.com" as const;
