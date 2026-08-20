/**
 * TEST-LOCAL Canonical Content Hash v1 contract canonicalizer.
 *
 * Used ONLY for Phase 2B.9 golden-vector verification and documentation.
 * NOT the production Mail Approval hash service.
 *
 * Contract: docs/mail/canonical-content-hash-v1.md
 */
import { createHash } from "node:crypto";

export const CANONICAL_CONTENT_HASH_V1_DOMAIN = "ECHFRONT-MAIL-CONTENT-V1";
export const CANONICAL_CONTENT_HASH_V1_VERSION = 1;

export type CanonicalRecipientType = "to" | "cc" | "bcc";
export type CanonicalSensitivity = "normal" | "sensitive" | "restricted";
export type CanonicalComposeMode = "new" | "reply" | "reply_all" | "forward";
export type CanonicalDeliveryMode = "direct_attachment" | "secure_file";

export type CanonicalContentHashV1Recipient = {
  type: CanonicalRecipientType;
  address: string;
  display_name: string | null;
};

export type CanonicalContentHashV1SignatureAsset = {
  asset_ref: string;
  content_hash: string;
  mime_type: string;
  size_bytes: number;
  sort_order: number;
};

export type CanonicalContentHashV1Attachment = {
  content_hash: string;
  display_filename: string;
  mime_type: string;
  size_bytes: number;
  sort_order: number;
  delivery_mode: CanonicalDeliveryMode;
  secure_expiry_days: number | null;
};

/** Approval-relevant semantic inputs only. CRM / DB IDs are intentionally absent. */
export type CanonicalContentHashV1Input = {
  sender: {
    from_address: string;
    from_display_name: string | null;
  };
  subject: string;
  body: {
    body_text: string | null;
    body_html_sanitized: string | null;
  };
  sensitivity: CanonicalSensitivity;
  compose_mode: CanonicalComposeMode;
  recipients: CanonicalContentHashV1Recipient[];
  signature: {
    body_text: string | null;
    body_html_sanitized: string | null;
    assets: CanonicalContentHashV1SignatureAsset[];
  };
  attachments: CanonicalContentHashV1Attachment[];
};

const RECIPIENT_TYPE_ORDER: Record<CanonicalRecipientType, number> = {
  to: 0,
  cc: 1,
  bcc: 2,
};

export function normalizeEmailAddress(address: string): string {
  return address.trim().normalize("NFC").toLowerCase();
}

export function normalizeDisplayName(displayName: string | null): string {
  if (displayName === null) return "";
  return displayName.normalize("NFC");
}

export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function normalizeBodyString(value: string | null): string {
  if (value === null) return "";
  return normalizeNewlines(value.normalize("NFC"));
}

export function normalizeSubject(value: string): string {
  return normalizeNewlines(value.normalize("NFC"));
}

export function normalizeMimeType(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeAssetRef(value: string): string {
  return value.normalize("NFC");
}

export function normalizeDisplayFilename(value: string): string {
  return value.normalize("NFC");
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareNullableIntegers(
  a: number | null,
  b: number | null,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a - b;
}

function sortRecipients(
  recipients: CanonicalContentHashV1Recipient[],
): Array<{ type: CanonicalRecipientType; address: string; display_name: string }> {
  return recipients
    .map((recipient) => ({
      type: recipient.type,
      address: normalizeEmailAddress(recipient.address),
      display_name: normalizeDisplayName(recipient.display_name),
    }))
    .sort((a, b) => {
      const typeDiff =
        RECIPIENT_TYPE_ORDER[a.type] - RECIPIENT_TYPE_ORDER[b.type];
      if (typeDiff !== 0) return typeDiff;
      const addressDiff = compareStrings(a.address, b.address);
      if (addressDiff !== 0) return addressDiff;
      return compareStrings(a.display_name, b.display_name);
    });
}

type CanonicalSignatureAsset = {
  asset_ref: string;
  content_hash: string;
  mime_type: string;
  size_bytes: number;
};

function sortSignatureAssets(
  assets: CanonicalContentHashV1SignatureAsset[],
): CanonicalSignatureAsset[] {
  return assets
    .map((asset) => ({
      asset_ref: normalizeAssetRef(asset.asset_ref),
      content_hash: asset.content_hash.toLowerCase(),
      mime_type: normalizeMimeType(asset.mime_type),
      size_bytes: asset.size_bytes,
    }))
    .sort((a, b) => {
      const refDiff = compareStrings(a.asset_ref, b.asset_ref);
      if (refDiff !== 0) return refDiff;
      const hashDiff = compareStrings(a.content_hash, b.content_hash);
      if (hashDiff !== 0) return hashDiff;
      const mimeDiff = compareStrings(a.mime_type, b.mime_type);
      if (mimeDiff !== 0) return mimeDiff;
      return a.size_bytes - b.size_bytes;
    });
}

type CanonicalAttachment = {
  content_hash: string;
  display_filename: string;
  mime_type: string;
  size_bytes: number;
  delivery_mode: CanonicalDeliveryMode;
  secure_expiry_days: number | null;
};

function sortAttachments(
  attachments: CanonicalContentHashV1Attachment[],
): CanonicalAttachment[] {
  return attachments
    .map((attachment) => ({
      sort_order: attachment.sort_order,
      canonical: {
        content_hash: attachment.content_hash.toLowerCase(),
        display_filename: normalizeDisplayFilename(attachment.display_filename),
        mime_type: normalizeMimeType(attachment.mime_type),
        size_bytes: attachment.size_bytes,
        delivery_mode: attachment.delivery_mode,
        secure_expiry_days:
          attachment.delivery_mode === "direct_attachment"
            ? null
            : attachment.secure_expiry_days,
      },
    }))
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      const hashDiff = compareStrings(
        a.canonical.content_hash,
        b.canonical.content_hash,
      );
      if (hashDiff !== 0) return hashDiff;
      const nameDiff = compareStrings(
        a.canonical.display_filename,
        b.canonical.display_filename,
      );
      if (nameDiff !== 0) return nameDiff;
      const mimeDiff = compareStrings(
        a.canonical.mime_type,
        b.canonical.mime_type,
      );
      if (mimeDiff !== 0) return mimeDiff;
      if (a.canonical.size_bytes !== b.canonical.size_bytes) {
        return a.canonical.size_bytes - b.canonical.size_bytes;
      }
      const modeDiff = compareStrings(
        a.canonical.delivery_mode,
        b.canonical.delivery_mode,
      );
      if (modeDiff !== 0) return modeDiff;
      return compareNullableIntegers(
        a.canonical.secure_expiry_days,
        b.canonical.secure_expiry_days,
      );
    })
    .map((entry) => entry.canonical);
}

export function buildCanonicalContentHashV1Payload(
  input: CanonicalContentHashV1Input,
): Record<string, unknown> {
  return {
    domain: CANONICAL_CONTENT_HASH_V1_DOMAIN,
    hash_version: CANONICAL_CONTENT_HASH_V1_VERSION,
    sender: {
      from_address: normalizeEmailAddress(input.sender.from_address),
      from_display_name: normalizeDisplayName(input.sender.from_display_name),
    },
    subject: normalizeSubject(input.subject),
    body: {
      body_text: normalizeBodyString(input.body.body_text),
      body_html_sanitized: normalizeBodyString(input.body.body_html_sanitized),
    },
    sensitivity: input.sensitivity,
    compose_mode: input.compose_mode,
    recipients: sortRecipients(input.recipients),
    signature: {
      body_text: normalizeBodyString(input.signature.body_text),
      body_html_sanitized: normalizeBodyString(input.signature.body_html_sanitized),
      assets: sortSignatureAssets(input.signature.assets),
    },
    attachments: sortAttachments(input.attachments),
  };
}

export function canonicalizeForDeterministicJson(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error("Canonical JSON allows integers only");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeForDeterministicJson(entry));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalizeForDeterministicJson(record[key]);
    }
    return sorted;
  }
  throw new Error(`Unsupported canonical JSON type: ${typeof value}`);
}

export function deterministicCanonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeForDeterministicJson(value));
}

export function computeCanonicalContentHashV1(
  input: CanonicalContentHashV1Input,
): string {
  const payload = buildCanonicalContentHashV1Payload(input);
  const json = deterministicCanonicalJsonStringify(payload);
  return createHash("sha256").update(json, "utf8").digest("hex");
}
