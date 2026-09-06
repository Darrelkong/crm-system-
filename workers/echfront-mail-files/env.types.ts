/**
 * Dedicated download Worker environment contract.
 *
 * The local Wrangler config points at crm-system-local and a local R2
 * namespace. Production bindings are intentionally not defined here.
 */
export type EchfrontMailFilesEnv = {
  /** Private bucket: crm-mail-large-attachments */
  LARGE_ATTACHMENTS: R2Bucket;
  /** Internal-only CRM authorization service binding. */
  CRM_SYSTEM: Fetcher;
  /** Shared secret for the internal service-binding RPC; never a URL token. */
  CRM_SYSTEM_GATEWAY_SECRET?: string;
};

export const ECHFRONT_MAIL_FILES_WORKER_NAME = "echfront-mail-files" as const;

export const ECHFRONT_MAIL_FILES_PUBLIC_HOST = "files.echfronthk.com" as const;
