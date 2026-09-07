import type { Database } from "@/lib/db";

export type IssueLargeAttachmentDownloadTokenInput = {
  lifecycleId: string;
  storedFileId: string;
  recipientExpiresAt: string;
  sentAt: string;
  authorizationPath: "admin_direct" | "staff_approved";
  trustNowIso?: string;
};

export type IssuedLargeAttachmentDownloadToken = {
  rawToken: string;
  downloadPath: string;
  downloadUrl: string;
  lifecycleId: string;
  recipientExpiresAt: string;
};

export class LargeAttachmentDownloadTokenIssuanceError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "INVALID_LINEAGE"
    | "INVALID_EXPIRY"
    | "ALREADY_ISSUED"
    | "NOT_DOWNLOADABLE";

  constructor(
    code: LargeAttachmentDownloadTokenIssuanceError["code"],
    message: string,
  ) {
    super(message);
    this.name = "LargeAttachmentDownloadTokenIssuanceError";
    this.code = code;
  }
}

/**
 * Standalone issuance is intentionally disabled in 2C2.2.
 *
 * Recipient capabilities are created only by the send-operation path, which
 * persists a delivery-token row before rendering and dispatching the email.
 */
export async function issueLargeAttachmentDownloadToken(
  db: Database,
  input: IssueLargeAttachmentDownloadTokenInput,
): Promise<IssuedLargeAttachmentDownloadToken> {
  void db;
  void input;
  throw new LargeAttachmentDownloadTokenIssuanceError(
    "NOT_DOWNLOADABLE",
    "Recipient capabilities are created only during durable outbound dispatch",
  );
}

export function isRecipientDownloadExpired(
  recipientExpiresAt: string,
  trustNowIso: string,
): boolean {
  const expiryMs = Date.parse(recipientExpiresAt);
  const nowMs = Date.parse(trustNowIso);
  return (
    !Number.isFinite(expiryMs) ||
    !Number.isFinite(nowMs) ||
    expiryMs <= nowMs
  );
}
