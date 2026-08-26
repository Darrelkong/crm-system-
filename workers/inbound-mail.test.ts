import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  assertInboundMailBindings,
  handleCloudflareInboundEmail,
  type InboundMailEnv,
} from "./inbound-mail";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(`${ROOT}/${path}`, "utf8");
}

function mockEmailMessage(raw: string, to = "daniel.hayes@echfronthk.com") {
  const rawBytes = new TextEncoder().encode(raw);
  return {
    from: "sender@external.test",
    to,
    headers: new Headers(),
    rawSize: rawBytes.byteLength,
    raw: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(rawBytes);
        controller.close();
      },
    }),
  };
}

describe("inbound mail worker static config", () => {
  it("wrangler.inbound-mail.jsonc uses isolated worker name and minimum bindings", () => {
    const config = read("wrangler.inbound-mail.jsonc");
    assert.match(config, /"name":\s*"crm-system-inbound-mail"/);
    assert.match(config, /"main":\s*"workers\/inbound-mail.ts"/);
    assert.match(config, /"binding":\s*"DB"/);
    assert.match(config, /"database_name":\s*"crm-db"/);
    assert.match(config, /"binding":\s*"ATTACHMENTS"/);
    assert.match(config, /"bucket_name":\s*"crm-attachments"/);
    assert.match(config, /"workers_dev":\s*false/);
    assert.doesNotMatch(config, /"send_email"/);
    assert.doesNotMatch(config, /"routes"/);
    assert.doesNotMatch(config, /"crons"/);
  });

  it("worker source exports email handler only and reuses staging adapter", () => {
    const worker = read("workers/inbound-mail.ts");
    assert.match(worker, /async email/);
    assert.doesNotMatch(worker, /async fetch/);
    assert.doesNotMatch(worker, /async scheduled/);
    assert.match(worker, /stageCloudflareInboundEmail/);
    assert.doesNotMatch(worker, /\.reply\(/);
    assert.doesNotMatch(worker, /\.forward\(/);
    assert.doesNotMatch(worker, /send_email/);
    assert.doesNotMatch(worker, /SendEmail/);
    assert.doesNotMatch(worker, /message\.reply\(/);
    assert.doesNotMatch(worker, /message\.forward\(/);
  });

  it("package scripts declare deploy and dry-run only", () => {
    const pkg = read("package.json");
    assert.match(pkg, /"inbound-mail:deploy"/);
    assert.match(pkg, /"inbound-mail:dry-run"/);
  });
});

describe("inbound mail worker wiring", () => {
  it("fails clearly when DB binding is missing", () => {
    assert.throws(
      () =>
        assertInboundMailBindings({
          DB: undefined as unknown as D1Database,
          ATTACHMENTS: {} as R2Bucket,
        }),
      /DB D1 binding/,
    );
  });

  it("fails clearly when ATTACHMENTS binding is missing", () => {
    assert.throws(
      () =>
        assertInboundMailBindings({
          DB: {} as D1Database,
          ATTACHMENTS: undefined as unknown as R2Bucket,
        }),
      /ATTACHMENTS R2 binding/,
    );
  });

  it("handleCloudflareInboundEmail rejects missing bindings before staging", async () => {
    await assert.rejects(
      () =>
        handleCloudflareInboundEmail(
          mockEmailMessage("From: a@b\n\nx"),
          {
            DB: undefined as unknown as D1Database,
            ATTACHMENTS: {} as R2Bucket,
          },
        ),
      /DB D1 binding/,
    );
  });
});
