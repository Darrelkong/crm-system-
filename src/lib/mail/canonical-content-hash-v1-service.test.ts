import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCanonicalContentHashV1 } from "@/lib/mail/canonical-content-hash-v1-contract";
import {
  buildCanonicalHashInputFromRevisionSemantics,
  computeOutboundRevisionContentHashV1,
} from "@/lib/mail/canonical-content-hash-v1-service";

describe("canonical content hash v1 production wrapper", () => {
  it("matches frozen contract implementation", () => {
    const source = {
      fromAddress: "staff@example.test",
      fromDisplayName: "Staff User",
      subject: "Project Update",
      bodyText: "Hello team.",
      bodyHtmlSanitized: "<p>Hello team.</p>",
      sensitivity: "normal" as const,
      composeMode: "new" as const,
      recipients: [
        { type: "to" as const, address: "alice@example.test", display_name: "Alice" },
      ],
      signature: {
        bodyText: "Regards,",
        bodyHtmlSanitized: "<p>Regards,</p>",
        assets: [],
      },
      attachments: [],
    };

    const input = buildCanonicalHashInputFromRevisionSemantics(source);
    const wrapped = computeOutboundRevisionContentHashV1(input);
    const direct = computeCanonicalContentHashV1(input);

    assert.equal(wrapped.contentHash, direct);
    assert.equal(wrapped.hashVersion, 1);
  });

  it("changes hash when attachment relative order changes", () => {
    const base = {
      fromAddress: "staff@example.test",
      fromDisplayName: null,
      subject: "Subject",
      bodyText: "Body",
      bodyHtmlSanitized: null,
      sensitivity: "normal" as const,
      composeMode: "new" as const,
      recipients: [
        { type: "to" as const, address: "a@example.test", display_name: null },
      ],
      signature: { bodyText: "", bodyHtmlSanitized: null, assets: [] },
      attachments: [
        {
          content_hash: "a".repeat(64),
          display_filename: "A.pdf",
          mime_type: "application/pdf",
          size_bytes: 100,
          sort_order: 10,
          delivery_mode: "direct_attachment" as const,
          secure_expiry_days: null,
        },
        {
          content_hash: "b".repeat(64),
          display_filename: "B.pdf",
          mime_type: "application/pdf",
          size_bytes: 200,
          sort_order: 20,
          delivery_mode: "direct_attachment" as const,
          secure_expiry_days: null,
        },
      ],
    };

    const reversed = structuredClone(base);
    reversed.attachments = [
      { ...base.attachments[1], sort_order: 0 },
      { ...base.attachments[0], sort_order: 1 },
    ];

    const hashA = computeOutboundRevisionContentHashV1(
      buildCanonicalHashInputFromRevisionSemantics(base),
    ).contentHash;
    const hashB = computeOutboundRevisionContentHashV1(
      buildCanonicalHashInputFromRevisionSemantics(reversed),
    ).contentHash;

    assert.notEqual(hashA, hashB);
  });
});
