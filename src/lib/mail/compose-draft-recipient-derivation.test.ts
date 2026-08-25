import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveSeedRecipients } from "@/lib/mail/compose-draft-recipient-derivation";
import { MAX_OUTBOUND_RECIPIENTS } from "@/lib/mail/outbound-recipient-validation";

const inboundMessage = {
  direction: "inbound" as const,
  fromAddress: "sender@example.com",
};

const outboundMessage = {
  direction: "outbound" as const,
  fromAddress: "staff@echfronthk.com",
};

describe("deriveSeedRecipients", () => {
  it("reply inbound targets from address", () => {
    const result = deriveSeedRecipients({
      mode: "reply",
      message: inboundMessage,
      visibleRecipients: [
        { recipientType: "to", address: "team@echfronthk.com", displayName: null, sortOrder: 0 },
      ],
      selfAddresses: ["team@echfronthk.com"],
    });
    assert.deepEqual(result.recipients.map((r) => r.address), ["sender@example.com"]);
  });

  it("reply outbound targets original To excluding self", () => {
    const result = deriveSeedRecipients({
      mode: "reply",
      message: outboundMessage,
      visibleRecipients: [
        { recipientType: "to", address: "client@example.com", displayName: null, sortOrder: 0 },
        { recipientType: "to", address: "staff@echfronthk.com", displayName: null, sortOrder: 1 },
      ],
      selfAddresses: ["staff@echfronthk.com"],
    });
    assert.deepEqual(result.recipients.map((r) => r.address), ["client@example.com"]);
  });

  it("reply outbound falls back to Cc when To is only self", () => {
    const result = deriveSeedRecipients({
      mode: "reply",
      message: outboundMessage,
      visibleRecipients: [
        { recipientType: "to", address: "staff@echfronthk.com", displayName: null, sortOrder: 0 },
        { recipientType: "cc", address: "client@example.com", displayName: null, sortOrder: 1 },
      ],
      selfAddresses: ["staff@echfronthk.com"],
    });
    assert.deepEqual(result.recipients.map((r) => r.address), ["client@example.com"]);
  });

  it("reply all inbound includes sender, To, Cc and excludes self", () => {
    const result = deriveSeedRecipients({
      mode: "reply_all",
      message: inboundMessage,
      visibleRecipients: [
        { recipientType: "to", address: "team@echfronthk.com", displayName: null, sortOrder: 0 },
        { recipientType: "to", address: "other@example.com", displayName: null, sortOrder: 1 },
        { recipientType: "cc", address: "cc@example.com", displayName: null, sortOrder: 2 },
        { recipientType: "bcc", address: "hidden@example.com", displayName: null, sortOrder: 3 },
      ],
      selfAddresses: ["team@echfronthk.com"],
    });
    const to = result.recipients.filter((r) => r.recipientType === "to").map((r) => r.address);
    const cc = result.recipients.filter((r) => r.recipientType === "cc").map((r) => r.address);
    const bcc = result.recipients.filter((r) => r.recipientType === "bcc");
    assert.deepEqual(to, ["sender@example.com", "other@example.com"]);
    assert.deepEqual(cc, ["cc@example.com"]);
    assert.equal(bcc.length, 0);
  });

  it("reply all never includes historical Bcc even when visible", () => {
    const result = deriveSeedRecipients({
      mode: "reply_all",
      message: inboundMessage,
      visibleRecipients: [
        { recipientType: "to", address: "team@echfronthk.com", displayName: null, sortOrder: 0 },
        { recipientType: "bcc", address: "hidden@example.com", displayName: null, sortOrder: 1 },
      ],
      selfAddresses: ["team@echfronthk.com"],
    });
    assert.equal(
      result.recipients.some((recipient) => recipient.recipientType === "bcc"),
      false,
    );
  });

  it("reply all outbound excludes source from and self", () => {
    const result = deriveSeedRecipients({
      mode: "reply_all",
      message: outboundMessage,
      visibleRecipients: [
        { recipientType: "to", address: "client@example.com", displayName: null, sortOrder: 0 },
        { recipientType: "to", address: "staff@echfronthk.com", displayName: null, sortOrder: 1 },
        { recipientType: "cc", address: "cc@example.com", displayName: null, sortOrder: 2 },
      ],
      selfAddresses: ["staff@echfronthk.com"],
    });
    const addresses = result.recipients.map((r) => r.address);
    assert.ok(!addresses.includes("staff@echfronthk.com"));
    assert.ok(!addresses.includes(outboundMessage.fromAddress));
    assert.deepEqual(addresses, ["client@example.com", "cc@example.com"]);
  });

  it("reply all excludes only resolved From identity, not all authorized identities", () => {
    const result = deriveSeedRecipients({
      mode: "reply_all",
      message: inboundMessage,
      visibleRecipients: [
        {
          recipientType: "to",
          address: "daniel@echfronthk.com",
          displayName: null,
          sortOrder: 0,
        },
        {
          recipientType: "to",
          address: "info@echfronthk.com",
          displayName: null,
          sortOrder: 1,
        },
        {
          recipientType: "to",
          address: "external@example.com",
          displayName: null,
          sortOrder: 2,
        },
      ],
      selfAddresses: ["daniel@echfronthk.com"],
    });
    const addresses = result.recipients.map((recipient) => recipient.address);
    assert.ok(!addresses.includes("daniel@echfronthk.com"));
    assert.ok(addresses.includes("info@echfronthk.com"));
    assert.ok(addresses.includes("external@example.com"));
    assert.ok(addresses.includes("sender@example.com"));
  });

  it("reply all with ambiguous From does not blanket-remove authorized identities", () => {
    const result = deriveSeedRecipients({
      mode: "reply_all",
      message: inboundMessage,
      visibleRecipients: [
        {
          recipientType: "to",
          address: "daniel@echfronthk.com",
          displayName: null,
          sortOrder: 0,
        },
        {
          recipientType: "to",
          address: "info@echfronthk.com",
          displayName: null,
          sortOrder: 1,
        },
      ],
      selfAddresses: [],
    });
    const addresses = result.recipients.map((recipient) => recipient.address);
    assert.ok(addresses.includes("daniel@echfronthk.com"));
    assert.ok(addresses.includes("info@echfronthk.com"));
  });

  it("forward seeds empty recipients", () => {
    const result = deriveSeedRecipients({
      mode: "forward",
      message: inboundMessage,
      visibleRecipients: [
        { recipientType: "to", address: "team@echfronthk.com", displayName: null, sortOrder: 0 },
      ],
      selfAddresses: ["team@echfronthk.com"],
    });
    assert.deepEqual(result.recipients, []);
  });

  it("does not silently truncate more than max recipients", () => {
    const visibleRecipients = Array.from({ length: MAX_OUTBOUND_RECIPIENTS + 5 }, (_, index) => ({
      recipientType: "to" as const,
      address: `user${index}@example.com`,
      displayName: null,
      sortOrder: index,
    }));
    const result = deriveSeedRecipients({
      mode: "reply_all",
      message: inboundMessage,
      visibleRecipients,
      selfAddresses: [],
    });
    assert.equal(result.recipients.length, MAX_OUTBOUND_RECIPIENTS + 6);
  });

  it("skips invalid historical addresses without throwing", () => {
    const result = deriveSeedRecipients({
      mode: "reply",
      message: { direction: "inbound", fromAddress: "   " },
      visibleRecipients: [],
      selfAddresses: [],
    });
    assert.deepEqual(result.recipients, []);
  });
});
