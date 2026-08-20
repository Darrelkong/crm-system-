import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inboundCanonicalSemanticGraphsEqual,
} from "@/lib/mail/inbound-canonical-semantic";
import type { InboundCanonicalSemanticGraph } from "@/lib/mail/inbound-canonical-semantic";

function baseGraph(): InboundCanonicalSemanticGraph {
  return {
    direction: "inbound",
    fromAddress: "sender@external.test",
    fromDisplayName: null,
    subject: "Subject",
    subjectNormalized: "subject",
    previewText: "Body",
    internetMessageId: "<same@external.test>",
    inReplyTo: null,
    referencesHeader: null,
    bodyText: "Body",
    bodyHtmlSanitized: null,
    recipients: [
      {
        recipientType: "to",
        address: "visible@example.com",
        displayName: null,
        sortOrder: 0,
      },
    ],
    attachments: [],
  };
}

describe("inbound canonical semantic comparison", () => {
  it("treats identical graphs as equal", () => {
    const left = baseGraph();
    const right = baseGraph();
    assert.equal(inboundCanonicalSemanticGraphsEqual(left, right), true);
  });

  it("detects subject semantic mismatch", () => {
    const left = baseGraph();
    const right = { ...baseGraph(), subject: "Different" };
    assert.equal(inboundCanonicalSemanticGraphsEqual(left, right), false);
  });

  it("detects attachment hash mismatch", () => {
    const left = baseGraph();
    const right = {
      ...baseGraph(),
      attachments: [
        {
          contentHash: "a".repeat(64),
          sizeBytes: 10,
          mimeType: "application/pdf",
          originalFilename: "a.pdf",
          displayFilename: "a.pdf",
          sortOrder: 0,
        },
      ],
    };
    assert.equal(inboundCanonicalSemanticGraphsEqual(left, right), false);
  });
});
