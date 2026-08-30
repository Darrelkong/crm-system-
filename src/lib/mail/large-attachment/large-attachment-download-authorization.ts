/**
 * Download authorization boundary — Phase 2A.1 architecture contract (not deployed).
 *
 * Public Worker `echfront-mail-files` MUST NOT receive broad CRM D1 binding in V1.
 * It calls crm-system via Cloudflare Service Binding for minimal authorization lookup.
 */

export const ECHFRONT_MAIL_FILES_WORKER_NAME = "echfront-mail-files" as const;

export const CRM_SYSTEM_SERVICE_BINDING_NAME = "CRM_SYSTEM" as const;

/** Public file Worker request — bearer token only. */
export type LargeAttachmentPublicDownloadRequest = {
  bearerToken: string;
};

/** Minimal authorized payload returned to public Worker — no CRM/customer records. */
export type LargeAttachmentInternalDownloadAuthorizationGranted = {
  authorized: true;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageVersion: string;
  storageEtag: string;
  recipientExpiresAt: string;
};

export type LargeAttachmentInternalDownloadAuthorizationDenied = {
  authorized: false;
};

export type LargeAttachmentInternalDownloadAuthorizationResult =
  | LargeAttachmentInternalDownloadAuthorizationGranted
  | LargeAttachmentInternalDownloadAuthorizationDenied;

/** crm-system internal service responsibilities (D1 transactions stay in CRM data plane). */
export type LargeAttachmentInternalDownloadAuthorizationService = {
  authorizePublicDownload(input: {
    tokenHash: string;
    trustNowIso: string;
  }): Promise<LargeAttachmentInternalDownloadAuthorizationResult>;
};

/** Public Worker must not expose raw bearer token through persistence or lookup DTOs. */
export type LargeAttachmentInternalDownloadLookupPersistedFields = {
  downloadTokenHash: string;
  downloadCount: number;
  lastDownloadedAt: string | null;
};

export function toInternalDownloadLookupPersistedFields(input: {
  downloadTokenHash: string;
  downloadCount?: number;
  lastDownloadedAt?: string | null;
}): LargeAttachmentInternalDownloadLookupPersistedFields {
  return {
    downloadTokenHash: input.downloadTokenHash,
    downloadCount: input.downloadCount ?? 0,
    lastDownloadedAt: input.lastDownloadedAt ?? null,
  };
}

export function assertPublicDownloadWorkerHasNoDirectD1Binding(env: {
  DB?: unknown;
}): void {
  if (env.DB !== undefined) {
    throw new Error("Public file Worker must not bind broad CRM D1 in V1");
  }
}

export function assertPublicDownloadWorkerHasNoBusinessEmail(env: {
  BUSINESS_EMAIL?: unknown;
  EMAIL?: unknown;
}): void {
  if (env.BUSINESS_EMAIL !== undefined || env.EMAIL !== undefined) {
    throw new Error("Public file Worker must not bind mail sender capabilities");
  }
}

export function sanitizeInternalDownloadAuthorizationResult(
  result: LargeAttachmentInternalDownloadAuthorizationResult,
): LargeAttachmentInternalDownloadAuthorizationResult {
  if (!result.authorized) {
    return { authorized: false };
  }
  return result;
}
