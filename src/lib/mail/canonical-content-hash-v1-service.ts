import {
  CANONICAL_CONTENT_HASH_V1_VERSION,
  computeCanonicalContentHashV1,
  type CanonicalContentHashV1Attachment,
  type CanonicalContentHashV1Input,
  type CanonicalContentHashV1Recipient,
  type CanonicalContentHashV1SignatureAsset,
} from "@/lib/mail/canonical-content-hash-v1-contract";

export {
  CANONICAL_CONTENT_HASH_V1_DOMAIN,
  CANONICAL_CONTENT_HASH_V1_VERSION,
  computeCanonicalContentHashV1,
} from "@/lib/mail/canonical-content-hash-v1-contract";

export function computeOutboundRevisionContentHashV1(
  input: CanonicalContentHashV1Input,
): { contentHash: string; hashVersion: number } {
  return {
    contentHash: computeCanonicalContentHashV1(input),
    hashVersion: CANONICAL_CONTENT_HASH_V1_VERSION,
  };
}

export type OutboundRevisionHashSource = {
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string;
  bodyText: string;
  bodyHtmlSanitized: string | null;
  sensitivity: CanonicalContentHashV1Input["sensitivity"];
  composeMode: CanonicalContentHashV1Input["compose_mode"];
  recipients: CanonicalContentHashV1Recipient[];
  signature: {
    bodyText: string;
    bodyHtmlSanitized: string | null;
    assets: CanonicalContentHashV1SignatureAsset[];
  };
  attachments: CanonicalContentHashV1Attachment[];
};

export function buildCanonicalHashInputFromRevisionSemantics(
  source: OutboundRevisionHashSource,
): CanonicalContentHashV1Input {
  return {
    sender: {
      from_address: source.fromAddress,
      from_display_name: source.fromDisplayName,
    },
    subject: source.subject,
    body: {
      body_text: source.bodyText,
      body_html_sanitized: source.bodyHtmlSanitized,
    },
    sensitivity: source.sensitivity,
    compose_mode: source.composeMode,
    recipients: source.recipients,
    signature: {
      body_text: source.signature.bodyText,
      body_html_sanitized: source.signature.bodyHtmlSanitized,
      assets: source.signature.assets,
    },
    attachments: source.attachments,
  };
}
