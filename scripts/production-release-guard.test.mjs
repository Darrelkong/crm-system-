import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  assertProductionSource,
  assertReleaseArtifact,
  ProductionReleaseGuardError,
  readReleaseMetadata,
} from "./production-release-guard.mjs";

const HEAD = "7aeedd082a42e690932ee1395eef1bc2db590c92";
const OTHER_SHA = "328974a42475b9d01f9dfa4fa9841eb25dffdb11";

function source(overrides = {}) {
  return {
    branch: "main",
    head: HEAD,
    originMain: HEAD,
    status: "",
    packageDiff: "",
    ...overrides,
  };
}

describe("production release guard", () => {
  it("allows a clean main source matching origin/main", () => {
    assert.doesNotThrow(() => assertProductionSource(source()));
  });

  it("blocks a dirty worktree", () => {
    assert.throws(
      () => assertProductionSource(source({ status: " M src/app.tsx" })),
      ProductionReleaseGuardError,
    );
  });

  it("blocks package or lockfile drift", () => {
    assert.throws(
      () => assertProductionSource(source({ packageDiff: "diff -- package.json" })),
      ProductionReleaseGuardError,
    );
  });

  it("blocks a source revision that differs from origin/main", () => {
    assert.throws(
      () => assertProductionSource(source({ originMain: OTHER_SHA })),
      ProductionReleaseGuardError,
    );
  });

  it("blocks a non-production branch", () => {
    assert.throws(
      () => assertProductionSource(source({ branch: "fix/post-release-hardening" })),
      ProductionReleaseGuardError,
    );
  });

  it("allows a matching artifact marker", () => {
    assert.doesNotThrow(() =>
      assertReleaseArtifact({
        metadata: {
          gitSha: HEAD,
          builtAt: "2026-09-05T15:00:00.000Z",
          source: "production-release",
        },
        head: HEAD,
        originMain: HEAD,
      }),
    );
  });

  it("blocks a stale artifact marker", () => {
    assert.throws(
      () =>
        assertReleaseArtifact({
          metadata: {
            gitSha: OTHER_SHA,
            builtAt: "2026-09-05T15:00:00.000Z",
            source: "production-release",
          },
          head: HEAD,
          originMain: HEAD,
        }),
      ProductionReleaseGuardError,
    );
  });

  it("blocks a missing artifact marker", async () => {
    await assert.rejects(
      readReleaseMetadata(
        "/private/tmp/crm-system-missing-production-release-meta.json",
      ),
      ProductionReleaseGuardError,
    );
  });

  it("keeps the test path read-only and avoids standalone Wrangler deploys", async () => {
    const script = await readFile(
      new URL("./deploy-production.mjs", import.meta.url),
      "utf8",
    );
    assert.match(script, /opennextjs-cloudflare", "deploy"/);
    assert.doesNotMatch(script, /wrangler", "deploy"/);
  });
});
