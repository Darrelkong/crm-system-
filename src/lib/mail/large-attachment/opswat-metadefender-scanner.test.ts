import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpswatMetaDefenderScanner,
  OpswatMetaDefenderScanError,
} from "./opswat-metadefender-scanner";

const API_KEY = "test-only-key";
const SHA256 = "a".repeat(64);

function streamFrom(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("submits a raw stream with private scanning and private processing forced", async () => {
  const captured: { request: { url: string; init: RequestInit } | null } = {
    request: null,
  };
  const scanner = createOpswatMetaDefenderScanner({
    apiKey: API_KEY,
    endpoint: "https://scanner.example/v4",
    fetchImpl: async (url, init) => {
      captured.request = { url: String(url), init: init ?? {} };
      return response({ data_id: "job-1" });
    },
  });

  const body = streamFrom("synthetic attachment");
  const submitted = await scanner.submit({
    body,
    contentLength: 20,
    filename: "../safe report.pdf",
    mimeType: "application/pdf",
  });

  assert.equal(submitted.providerJobId, "job-1");
  assert.ok(captured.request);
  assert.equal(captured.request.url, "https://scanner.example/v4/file");
  assert.equal(captured.request.init.method, "POST");
  assert.equal(captured.request.init.body, body);
  const headers = captured.request.init.headers as Record<string, string>;
  assert.equal(headers.apikey, API_KEY);
  assert.equal(headers.samplesharing, "0");
  assert.equal(headers.privateprocessing, "1");
  assert.equal(headers["Content-Length"], "20");
  assert.equal(headers.filename, "safe report.pdf");
});

test("normalizes an explicit completed clean verdict and provider SHA-256", async () => {
  const scanner = createOpswatMetaDefenderScanner({
    apiKey: API_KEY,
    endpoint: "https://scanner.example/v4",
    fetchImpl: async () =>
      response({
        file_info: { sha256: SHA256.toUpperCase() },
        scan_results: {
          progress_percentage: 100,
          scan_all_result_a: 0,
        },
      }),
  });

  assert.deepEqual(await scanner.poll({ providerJobId: "job-clean" }), {
    providerJobId: "job-clean",
    status: "clean",
    providerObservedSha256: SHA256,
  });
});

test("normalizes pending, malware, and unsupported results conservatively", async () => {
  let payload: unknown = {
    scan_results: { progress_percentage: 40, scan_all_result_a: 0 },
  };
  const scanner = createOpswatMetaDefenderScanner({
    apiKey: API_KEY,
    endpoint: "https://scanner.example/v4",
    fetchImpl: async () => response(payload),
  });

  assert.equal(
    (await scanner.poll({ providerJobId: "job-pending" })).status,
    "pending",
  );

  payload = {
    scan_results: { progress_percentage: 100, scan_all_result_a: 1 },
  };
  assert.equal(
    (await scanner.poll({ providerJobId: "job-malware" })).status,
    "blocked",
  );

  payload = {
    scan_results: { progress_percentage: 100, scan_all_result_a: 253 },
  };
  const unsupported = await scanner.poll({ providerJobId: "job-unsupported" });
  assert.equal(unsupported.status, "scan_failed");
  assert.equal(unsupported.failureCode, "UNSUPPORTED_FILE");
});

test("does not turn unknown completed provider results into clean", async () => {
  const scanner = createOpswatMetaDefenderScanner({
    apiKey: API_KEY,
    endpoint: "https://scanner.example/v4",
    fetchImpl: async () =>
      response({
        scan_results: { progress_percentage: 100, scan_all_result_a: 99 },
      }),
  });

  await assert.rejects(
    scanner.poll({ providerJobId: "job-unknown" }),
    (error: unknown) =>
      error instanceof OpswatMetaDefenderScanError &&
      error.code === "PROVIDER_INVALID_RESPONSE" &&
      !error.retryable,
  );
});

test("maps timeout, rate limit, and unsupported HTTP responses", async () => {
  const makeScanner = (fetchImpl: typeof fetch) =>
    createOpswatMetaDefenderScanner({
      apiKey: API_KEY,
      endpoint: "https://scanner.example/v4",
      fetchImpl,
    });

  await assert.rejects(
    makeScanner(async () => {
      throw new Error("timeout");
    }).poll({ providerJobId: "job-timeout" }),
    (error: unknown) =>
      error instanceof OpswatMetaDefenderScanError &&
      error.code === "PROVIDER_TIMEOUT" &&
      error.retryable,
  );
  await assert.rejects(
    makeScanner(async () => response({}, 429)).poll({
      providerJobId: "job-rate-limit",
    }),
    (error: unknown) =>
      error instanceof OpswatMetaDefenderScanError &&
      error.code === "PROVIDER_RATE_LIMIT" &&
      error.retryable,
  );
  await assert.rejects(
    makeScanner(async () => response({}, 415)).poll({
      providerJobId: "job-unsupported-http",
    }),
    (error: unknown) =>
      error instanceof OpswatMetaDefenderScanError &&
      error.code === "UNSUPPORTED_FILE" &&
      !error.retryable,
  );
});

test("aborts requests that exceed the configured provider timeout", async () => {
  const scanner = createOpswatMetaDefenderScanner({
    apiKey: API_KEY,
    endpoint: "https://scanner.example/v4",
    requestTimeoutMs: 5,
    fetchImpl: async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  });

  await assert.rejects(
    scanner.poll({ providerJobId: "job-timeout-abort" }),
    (error: unknown) =>
      error instanceof OpswatMetaDefenderScanError &&
      error.code === "PROVIDER_TIMEOUT" &&
      error.retryable,
  );
});

test("requires an HTTPS private endpoint and server-side API key", () => {
  assert.throws(
    () =>
      createOpswatMetaDefenderScanner({
        apiKey: API_KEY,
        endpoint: "http://scanner.example/v4",
      }),
    (error: unknown) =>
      error instanceof OpswatMetaDefenderScanError &&
      error.code === "CONFIGURATION",
  );
  assert.throws(
    () =>
      createOpswatMetaDefenderScanner({
        apiKey: "",
        endpoint: "https://scanner.example/v4",
      }),
    (error: unknown) =>
      error instanceof OpswatMetaDefenderScanError &&
      error.code === "CONFIGURATION",
  );
});

test("the adapter emits no logs containing the API key", async () => {
  const originalLog = console.log;
  const logs: unknown[][] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    const scanner = createOpswatMetaDefenderScanner({
      apiKey: API_KEY,
      endpoint: "https://scanner.example/v4",
      fetchImpl: async () => response({ data_id: "job-no-log" }),
    });
    await scanner.submit({
      body: streamFrom("test"),
      contentLength: 4,
      filename: "test.txt",
      mimeType: "text/plain",
    });
  } finally {
    console.log = originalLog;
  }
  assert.equal(
    logs.some((args: unknown[]) =>
      args.some((argument: unknown) => argument === API_KEY),
    ),
    false,
  );
  assert.equal(logs.length, 0);
});
