import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLargeAttachmentPublicDownloadUrl,
  generateLargeAttachmentDownloadTokenPair,
} from "../../src/lib/mail/large-attachment/large-attachment-download-token";
import { handleEchfrontMailFilesRequest } from "./index";
import type { EchfrontMailFilesEnv } from "./env.types";

const STORAGE_KEY =
  "mail/large-attachments/2026/09/00000000-0000-4000-8000-000000000001";
const BYTES = new TextEncoder().encode("file");
const TOKEN_PAIR = generateLargeAttachmentDownloadTokenPair(() =>
  new Uint8Array(Array.from({ length: 16 }, (_, index) => index + 1)),
);
const METADATA = {
  authorized: true as const,
  lifecycleId: "lifecycle-1",
  storageKey: STORAGE_KEY,
  filename: "客户报告.pdf",
  mimeType: "application/pdf",
  sizeBytes: BYTES.byteLength,
  storageVersion: "version-1",
  storageEtag: "etag-1",
  recipientExpiresAt: "2026-09-13T08:00:00.000Z",
};

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function fixtureEnv(options?: {
  authorize?: boolean;
  object?: "valid" | "missing" | "mismatch";
}) {
  let recordCount = 0;
  let headCount = 0;
  let getCount = 0;
  const mode = options?.object ?? "valid";
  const crmSystem = {
    async fetch(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const body = JSON.parse(String(init?.body)) as { action: string };
      if (
        init?.headers &&
        new Headers(init.headers).get("X-Crm-Large-Attachment-Gateway-Secret") !==
          "local-secret"
      ) {
        return new Response(null, { status: 404 });
      }
      if (body.action === "authorize") {
        return Response.json(
          options?.authorize === false ? { authorized: false } : METADATA,
        );
      }
      recordCount += 1;
      return Response.json({ recorded: true });
    },
  };

  const object = {
    body: streamFromBytes(BYTES),
    size: BYTES.byteLength,
    etag: mode === "mismatch" ? "wrong-etag" : "etag-1",
    version: "version-1",
  };
  const largeAttachments = {
    async head() {
      headCount += 1;
      return mode === "missing" ? null : object;
    },
    async get() {
      getCount += 1;
      return mode === "missing" ? null : object;
    },
  };

  return {
    env: {
      LARGE_ATTACHMENTS: largeAttachments,
      CRM_SYSTEM: crmSystem,
      CRM_SYSTEM_GATEWAY_SECRET: "local-secret",
    } as unknown as EchfrontMailFilesEnv,
    stats: {
      get recordCount() {
        return recordCount;
      },
      get headCount() {
        return headCount;
      },
      get getCount() {
        return getCount;
      },
    },
  };
}

describe("echfront-mail-files local gateway fixture", () => {
  it("streams the authorized object and records accounting", async () => {
    const fixture = fixtureEnv();
    const response = await handleEchfrontMailFilesRequest(
      new Request(
        `${buildLargeAttachmentPublicDownloadUrl(TOKEN_PAIR.token)}/download`,
      ),
      fixture.env,
      () => new Date("2026-09-06T08:00:00.000Z"),
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "file");
    assert.equal(response.headers.get("Content-Length"), "4");
    assert.match(
      response.headers.get("Content-Disposition") ?? "",
      /^attachment;.*filename\*=UTF-8''%E5%AE%A2%E6%88%B7%E6%8A%A5%E5%91%8A\.pdf$/,
    );
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(fixture.stats.headCount, 1);
    assert.equal(fixture.stats.getCount, 1);
    assert.equal(fixture.stats.recordCount, 1);
  });

  it("shows the recipient safety warning before streaming", async () => {
    const fixture = fixtureEnv();
    const response = await handleEchfrontMailFilesRequest(
      new Request(buildLargeAttachmentPublicDownloadUrl(TOKEN_PAIR.token)),
      fixture.env,
      () => new Date("2026-09-06T08:00:00.000Z"),
    );

    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /文件安全提示/);
    assert.match(html, /系统未进行自动安全扫描/);
    assert.match(
      response.headers.get("Content-Security-Policy") ?? "",
      /default-src 'none'/,
    );
    assert.equal(fixture.stats.headCount, 0);
    assert.equal(fixture.stats.getCount, 0);
    assert.equal(fixture.stats.recordCount, 0);
  });

  it("supports V1 replay until authorization state changes", async () => {
    const fixture = fixtureEnv();
    const request = () =>
      handleEchfrontMailFilesRequest(
        new Request(
          `${buildLargeAttachmentPublicDownloadUrl(TOKEN_PAIR.token)}/download`,
        ),
        fixture.env,
      );

    assert.equal((await request()).status, 200);
    assert.equal((await request()).status, 200);
    assert.equal(fixture.stats.recordCount, 2);
  });

  it("returns the generic unavailable response for invalid tokens and query overrides", async () => {
    const fixture = fixtureEnv();
    for (const url of [
      "https://files.echfronthk.com/f/not-a-token",
      "https://files.echfronthk.com/f/a%2Fb",
      "https://files.echfronthk.com/f/" + TOKEN_PAIR.token + "?storageKey=other",
    ]) {
      const response = await handleEchfrontMailFilesRequest(
        new Request(url),
        fixture.env,
      );
      assert.equal(response.status, 404);
      assert.match(await response.text(), /附件暂不可用/);
    }
    assert.equal(fixture.stats.headCount, 0);
  });

  it("fails closed for denied authorization and R2 identity failures", async () => {
    assert.equal(
      (
        await handleEchfrontMailFilesRequest(
          new Request(buildLargeAttachmentPublicDownloadUrl(TOKEN_PAIR.token)),
          fixtureEnv({ authorize: false }).env,
        )
      ).status,
      404,
    );
    for (const object of ["missing", "mismatch"] as const) {
      const fixture = fixtureEnv({ object });
      const response = await handleEchfrontMailFilesRequest(
        new Request(
          `${buildLargeAttachmentPublicDownloadUrl(TOKEN_PAIR.token)}/download`,
        ),
        fixture.env,
      );
      assert.equal(response.status, 404);
      assert.equal(fixture.stats.recordCount, 0);
    }
  });

  it("fails closed when required Production configuration is missing", async () => {
    const request = new Request(
      `${buildLargeAttachmentPublicDownloadUrl(TOKEN_PAIR.token)}/download`,
    );

    const fixture = fixtureEnv();
    assert.equal(
      (
        await handleEchfrontMailFilesRequest(
          request,
          { ...fixture.env, CRM_SYSTEM_GATEWAY_SECRET: undefined },
        )
      ).status,
      404,
    );

    assert.equal(
      (
        await handleEchfrontMailFilesRequest(
          request,
          { ...fixture.env, CRM_SYSTEM: undefined },
        )
      ).status,
      404,
    );

    assert.equal(
      (
        await handleEchfrontMailFilesRequest(
          request,
          { ...fixture.env, LARGE_ATTACHMENTS: undefined },
        )
      ).status,
      404,
    );
  });

  it("keeps the raw token out of the persisted representation", () => {
    assert.equal(TOKEN_PAIR.token.length, 22);
    assert.match(TOKEN_PAIR.token, /^[A-Za-z0-9_-]{22}$/);
    assert.match(TOKEN_PAIR.tokenHash, /^[0-9a-f]{64}$/);
    assert.notEqual(TOKEN_PAIR.tokenHash, TOKEN_PAIR.token);
  });
});
