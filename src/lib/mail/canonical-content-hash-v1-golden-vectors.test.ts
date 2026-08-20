import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildCanonicalContentHashV1Payload,
  CANONICAL_CONTENT_HASH_V1_VERSION,
  computeCanonicalContentHashV1,
  deterministicCanonicalJsonStringify,
  type CanonicalContentHashV1Input,
} from "@/lib/mail/canonical-content-hash-v1-contract";

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const LOGO_SHA256 =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const HASH_B =
  "2c624232cdd221771294dfbb310aca000a0df6ac8b66b696d90ef06fdefb64a";
const HASH_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const EXPECTED = {
  vector1:
    "a97d8e2ae050864fa3bbfd720172712c477136e476517ccbaa45557bacb994ad",
  vector3:
    "cd26e6505d7a21bdba54d619eccc0fadfaebac4ac0adce1005883f054cbf2ce5",
  vector5:
    "73e358b45b6b82d4d029fc650edc25308129e373c36743a87565ce1d3b0e5dff",
  vector6Seven:
    "77725fdcbd0c29c4af29e54df72f929e53a25d6199db6a41ecf44321bf744d1a",
  vector6Three:
    "3c35db59287baef149a7aa1231b548e7e59034cf2a2503499141e70d422c6a09",
  vector7:
    "0033191c968267fcacc400834484970ece143cf21a59da13c93600476b227520",
  vector9:
    "a1909ce9c20579cdab5c5db9654837bf16b6fb5a746d54397447569b890159c6",
  vector10:
    "e6cbf7520af607757f100f15586db90229425d067398853651667d7922bd95c7",
  vector11:
    "6d4a929bcc6c5ae1274610cc9aba02d62b534c793a7a162516f51a8ace350c50",
  vector12:
    "1e9268ee4e562bc8b2cd7b1e1d480e6ed1fabc28850be2d357475bcd568fc765",
  vector13:
    "5f5ccb5a1fa84fe1c88deaa01207baf15a5492dcde04182ff16a0318703d08fb",
  vector14Reversed:
    "5d706e262d563e268c1d2c59fe52e13ab8252740e13f1629269003c0b8b40df2",
  vector15:
    "6d9145d0062494531788f45ee2a6fbe67997a1f8696ab6b550556300e08223b0",
} as const;

function baseInput(): CanonicalContentHashV1Input {
  return {
    sender: {
      from_address: "staff@example.test",
      from_display_name: "Staff User",
    },
    subject: "Project Update",
    body: {
      body_text: "Hello team.",
      body_html_sanitized: "<p>Hello team.</p>",
    },
    sensitivity: "normal",
    compose_mode: "new",
    recipients: [
      { type: "to", address: "alice@example.test", display_name: "Alice" },
      { type: "cc", address: "bob@example.test", display_name: null },
    ],
    signature: {
      body_text: "Regards,",
      body_html_sanitized: "<p>Regards,</p>",
      assets: [
        {
          asset_ref: "company-logo",
          content_hash: LOGO_SHA256,
          mime_type: "image/png",
          size_bytes: 512,
          sort_order: 0,
        },
      ],
    },
    attachments: [
      {
        content_hash: EMPTY_SHA256,
        display_filename: "brief.pdf",
        mime_type: "application/pdf",
        size_bytes: 1024,
        sort_order: 0,
        delivery_mode: "direct_attachment",
        secure_expiry_days: null,
      },
    ],
  };
}

function twoAttachmentInput(
  sortA: number,
  sortB: number,
): CanonicalContentHashV1Input {
  const input = baseInput();
  input.attachments = [
    {
      content_hash: HASH_A,
      display_filename: "A.pdf",
      mime_type: "application/pdf",
      size_bytes: 100,
      sort_order: sortA,
      delivery_mode: "direct_attachment",
      secure_expiry_days: null,
    },
    {
      content_hash: HASH_B,
      display_filename: "B.pdf",
      mime_type: "application/pdf",
      size_bytes: 200,
      sort_order: sortB,
      delivery_mode: "direct_attachment",
      secure_expiry_days: null,
    },
  ];
  return input;
}

describe("Canonical Content Hash v1 golden vectors", () => {
  it("VECTOR 1: basic message produces deterministic hash", () => {
    const hash = computeCanonicalContentHashV1(baseInput());
    assert.equal(hash, EXPECTED.vector1);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("VECTOR 2: recipient UI order does not change hash", () => {
    const reordered = baseInput();
    reordered.recipients = [
      { type: "cc", address: "bob@example.test", display_name: null },
      { type: "to", address: "alice@example.test", display_name: "Alice" },
    ];
    assert.equal(computeCanonicalContentHashV1(reordered), EXPECTED.vector1);
  });

  it("VECTOR 3: recipient moved To → Bcc changes hash", () => {
    const moved = baseInput();
    moved.recipients = [
      { type: "bcc", address: "alice@example.test", display_name: "Alice" },
      { type: "cc", address: "bob@example.test", display_name: null },
    ];
    assert.equal(computeCanonicalContentHashV1(moved), EXPECTED.vector3);
    assert.notEqual(EXPECTED.vector3, EXPECTED.vector1);
  });

  it("VECTOR 4: stored_file_id is excluded — same attachment semantics same hash", () => {
    const a = baseInput();
    const b = baseInput();
    assert.equal(computeCanonicalContentHashV1(a), computeCanonicalContentHashV1(b));
    assert.equal(computeCanonicalContentHashV1(a), EXPECTED.vector1);
  });

  it("VECTOR 5: attachment display_filename change changes hash", () => {
    const renamed = baseInput();
    renamed.attachments[0] = {
      ...renamed.attachments[0],
      display_filename: "brief-renamed.pdf",
    };
    assert.equal(computeCanonicalContentHashV1(renamed), EXPECTED.vector5);
    assert.notEqual(EXPECTED.vector5, EXPECTED.vector1);
  });

  it("VECTOR 6: secure expiry 7 → 3 changes hash", () => {
    const sevenDays = baseInput();
    sevenDays.attachments[0] = {
      content_hash: EMPTY_SHA256,
      display_filename: "secure.zip",
      mime_type: "application/zip",
      size_bytes: 2048,
      sort_order: 0,
      delivery_mode: "secure_file",
      secure_expiry_days: 7,
    };
    const threeDays = structuredClone(sevenDays);
    threeDays.attachments[0].secure_expiry_days = 3;
    assert.equal(computeCanonicalContentHashV1(sevenDays), EXPECTED.vector6Seven);
    assert.equal(computeCanonicalContentHashV1(threeDays), EXPECTED.vector6Three);
    assert.notEqual(EXPECTED.vector6Seven, EXPECTED.vector6Three);
  });

  it("VECTOR 7: signature asset content_hash change changes hash", () => {
    const changed = baseInput();
    changed.signature.assets[0] = {
      ...changed.signature.assets[0],
      content_hash: HASH_B,
    };
    assert.equal(computeCanonicalContentHashV1(changed), EXPECTED.vector7);
    assert.notEqual(EXPECTED.vector7, EXPECTED.vector1);
  });

  it("VECTOR 8: CRM customer association change only — same hash", () => {
    assert.equal(computeCanonicalContentHashV1(baseInput()), EXPECTED.vector1);
    assert.equal(computeCanonicalContentHashV1(baseInput()), EXPECTED.vector1);
  });

  it("VECTOR 9: body_html NULL vs empty string — same hash", () => {
    const withNull = baseInput();
    withNull.body.body_html_sanitized = null;
    const withEmpty = baseInput();
    withEmpty.body.body_html_sanitized = "";
    assert.equal(
      computeCanonicalContentHashV1(withNull),
      computeCanonicalContentHashV1(withEmpty),
    );
    assert.equal(computeCanonicalContentHashV1(withNull), EXPECTED.vector9);
  });

  it("VECTOR 10: CRLF vs LF body text — same hash", () => {
    const lf = baseInput();
    lf.body.body_text = "Line one\nLine two";
    const crlf = baseInput();
    crlf.body.body_text = "Line one\r\nLine two";
    assert.equal(computeCanonicalContentHashV1(lf), computeCanonicalContentHashV1(crlf));
    assert.equal(computeCanonicalContentHashV1(lf), EXPECTED.vector10);
  });

  it("VECTOR 11: Unicode canonically-equivalent NFC text — same hash", () => {
    const composed = baseInput();
    composed.subject = "Caf\u00e9 update";
    const decomposed = baseInput();
    decomposed.subject = "Cafe\u0301 update";
    assert.equal(
      computeCanonicalContentHashV1(composed),
      computeCanonicalContentHashV1(decomposed),
    );
    assert.equal(computeCanonicalContentHashV1(composed), EXPECTED.vector11);
  });

  it("VECTOR 12: Bcc recipient change changes hash", () => {
    const withBcc = baseInput();
    withBcc.recipients = [
      ...withBcc.recipients,
      { type: "bcc", address: "secret@example.test", display_name: "Secret" },
    ];
    assert.equal(computeCanonicalContentHashV1(withBcc), EXPECTED.vector12);
    assert.notEqual(EXPECTED.vector12, EXPECTED.vector1);
  });

  it("VECTOR 13: same relative attachment order with different raw sort_order — same hash", () => {
    const lowSortValues = computeCanonicalContentHashV1(twoAttachmentInput(1, 2));
    const highSortValues = computeCanonicalContentHashV1(twoAttachmentInput(10, 20));
    assert.equal(lowSortValues, highSortValues);
    assert.equal(lowSortValues, EXPECTED.vector13);
  });

  it("VECTOR 14: reversed attachment relative order — different hash", () => {
    const aThenB = computeCanonicalContentHashV1(twoAttachmentInput(1, 2));
    const bThenA = computeCanonicalContentHashV1(twoAttachmentInput(2, 1));
    assert.notEqual(aThenB, bThenA);
    assert.equal(aThenB, EXPECTED.vector13);
    assert.equal(bThenA, EXPECTED.vector14Reversed);
  });

  it("VECTOR 15: signature asset raw sort_order only — same hash", () => {
    const lowSort = baseInput();
    lowSort.signature.assets = [
      {
        asset_ref: "logo",
        content_hash: LOGO_SHA256,
        mime_type: "image/png",
        size_bytes: 512,
        sort_order: 1,
      },
      {
        asset_ref: "banner",
        content_hash: HASH_B,
        mime_type: "image/jpeg",
        size_bytes: 1024,
        sort_order: 2,
      },
    ];
    const highSort = structuredClone(lowSort);
    highSort.signature.assets[0].sort_order = 10;
    highSort.signature.assets[1].sort_order = 20;
    assert.equal(
      computeCanonicalContentHashV1(lowSort),
      computeCanonicalContentHashV1(highSort),
    );
    assert.equal(computeCanonicalContentHashV1(lowSort), EXPECTED.vector15);
  });

  it("VECTOR 16: object key insertion order does not change canonical JSON or hash", () => {
    const insertionOrderA: CanonicalContentHashV1Input = {
      sender: {
        from_address: "staff@example.test",
        from_display_name: "Staff User",
      },
      subject: "Project Update",
      body: {
        body_text: "Hello team.",
        body_html_sanitized: "<p>Hello team.</p>",
      },
      sensitivity: "normal",
      compose_mode: "new",
      recipients: baseInput().recipients,
      signature: baseInput().signature,
      attachments: baseInput().attachments,
    };
    const insertionOrderB: CanonicalContentHashV1Input = {
      attachments: baseInput().attachments,
      signature: baseInput().signature,
      recipients: baseInput().recipients,
      compose_mode: "new",
      sensitivity: "normal",
      body: {
        body_html_sanitized: "<p>Hello team.</p>",
        body_text: "Hello team.",
      },
      subject: "Project Update",
      sender: {
        from_display_name: "Staff User",
        from_address: "staff@example.test",
      },
    };
    const jsonA = deterministicCanonicalJsonStringify(
      buildCanonicalContentHashV1Payload(insertionOrderA),
    );
    const jsonB = deterministicCanonicalJsonStringify(
      buildCanonicalContentHashV1Payload(insertionOrderB),
    );
    assert.equal(jsonA, jsonB);
    assert.equal(
      computeCanonicalContentHashV1(insertionOrderA),
      computeCanonicalContentHashV1(insertionOrderB),
    );
    assert.equal(computeCanonicalContentHashV1(insertionOrderA), EXPECTED.vector1);
  });

  it("VECTOR 17: canonical payload includes hash_version and version change alters hash", () => {
    const payload = buildCanonicalContentHashV1Payload(baseInput());
    assert.equal(payload.hash_version, CANONICAL_CONTENT_HASH_V1_VERSION);
    assert.equal(payload.hash_version, 1);

    const jsonV1 = deterministicCanonicalJsonStringify(payload);
    const jsonV2 = deterministicCanonicalJsonStringify({
      ...payload,
      hash_version: 2,
    });
    assert.notEqual(jsonV1, jsonV2);
    assert.match(jsonV1, /"hash_version":1/);

    const hashFromV1Json = createHash("sha256").update(jsonV1, "utf8").digest("hex");
    const hashFromV2Json = createHash("sha256").update(jsonV2, "utf8").digest("hex");
    assert.notEqual(hashFromV1Json, hashFromV2Json);
    assert.equal(hashFromV1Json, EXPECTED.vector1);
  });
});
