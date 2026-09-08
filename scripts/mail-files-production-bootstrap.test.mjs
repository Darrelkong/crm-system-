import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  assertBootstrapPreconditions,
  assertCrmProductionFlags,
  buildSecretsFileArgs,
  createEphemeralSecretsFile,
  parseWorkerPresence,
  readWorkerPresence,
  removeEphemeralSecretsFile,
} from "./mail-files-production-bootstrap.mjs";
import {
  assertGatewayProductionConfig,
  readGatewayProductionConfig,
} from "./mail-files-production-guard.mjs";

const repositoryRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const HEAD = "8f5371420d479541fb27ea1e9df6c500594d1226";

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

async function productionConfig() {
  return readGatewayProductionConfig(repositoryRoot);
}

describe("Mail Files first-deployment bootstrap guard", () => {
  it("accepts the approved first-create state and disabled CRM flags", async () => {
    const { config, source: gatewaySource } = await productionConfig();
    const crmSource = await readFile(`${repositoryRoot}/wrangler.jsonc`, "utf8");

    assert.doesNotThrow(() =>
      assertBootstrapPreconditions({
        source: source(),
        gatewayConfig: config,
        gatewaySource,
        crmSource,
        gatewayExists: false,
      }),
    );
    assert.doesNotThrow(() => assertGatewayProductionConfig(config, gatewaySource));
  });

  it("refuses an existing Gateway Worker", async () => {
    const { config, source: gatewaySource } = await productionConfig();
    const crmSource = await readFile(`${repositoryRoot}/wrangler.jsonc`, "utf8");

    assert.throws(
      () =>
        assertBootstrapPreconditions({
          source: source(),
          gatewayConfig: config,
          gatewaySource,
          crmSource,
          gatewayExists: true,
        }),
      /first-create only/,
    );
  });

  for (const [label, overrides] of [
    ["wrong branch", { branch: "fix/other" }],
    ["wrong HEAD", { head: "328974a42475b9d01f9dfa4fa9841eb25dffdb11" }],
    ["dirty worktree", { status: " M scripts/example.mjs" }],
  ]) {
    it(`refuses ${label}`, async () => {
      const { config, source: gatewaySource } = await productionConfig();
      const crmSource = await readFile(`${repositoryRoot}/wrangler.jsonc`, "utf8");

      assert.throws(() =>
        assertBootstrapPreconditions({
          source: source(overrides),
          gatewayConfig: config,
          gatewaySource,
          crmSource,
          gatewayExists: false,
        }),
      );
    });
  }

  it("refuses wrong Gateway bindings", async () => {
    const { config, source: gatewaySource } = await productionConfig();
    const crmSource = await readFile(`${repositoryRoot}/wrangler.jsonc`, "utf8");
    const wrongConfig = structuredClone(config);
    wrongConfig.services[0].service = "crm-system-local";

    assert.throws(
      () =>
        assertBootstrapPreconditions({
          source: source(),
          gatewayConfig: wrongConfig,
          gatewaySource,
          crmSource,
          gatewayExists: false,
        }),
      /CRM_SYSTEM/,
    );
  });

  it("refuses enabled runtime or send flags", async () => {
    const { config, source: gatewaySource } = await productionConfig();
    const crmSource = await readFile(`${repositoryRoot}/wrangler.jsonc`, "utf8");

    assert.throws(() =>
      assertCrmProductionFlags(
        crmSource.replace(
          '"MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED": "false"',
          '"MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED": "true"',
        ),
      ),
    );
    assert.throws(() =>
      assertBootstrapPreconditions({
        source: source(),
        gatewayConfig: config,
        gatewaySource,
        crmSource: crmSource.replace(
          '"MAIL_LARGE_ATTACHMENT_SEND_ENABLED": "false"',
          '"MAIL_LARGE_ATTACHMENT_SEND_ENABLED": "true"',
        ),
        gatewayExists: false,
      }),
    );
  });

  it("recognizes absent and existing Worker deployment metadata", () => {
    assert.equal(
      parseWorkerPresence({
        status: 1,
        stderr: 'Worker "echfront-mail-files" not found.',
      }),
      false,
    );
    assert.equal(parseWorkerPresence({ status: 0, stdout: "[]" }), false);
    assert.equal(
      parseWorkerPresence({
        status: 0,
        stdout: JSON.stringify([{ id: "deployment" }]),
      }),
      true,
    );
  });

  it("queries Worker existence without treating unrelated errors as absence", () => {
    const execute = (_command, _args, options) => ({
      ...options,
      status: 0,
      stdout: JSON.stringify([{ id: "deployment" }]),
      stderr: "",
    });
    assert.equal(
      readWorkerPresence(repositoryRoot, "echfront-mail-files", execute),
      true,
    );
    assert.throws(
      () =>
        readWorkerPresence(repositoryRoot, "echfront-mail-files", () => ({
          status: 1,
          stdout: "",
          stderr: "network failure",
        })),
      /Unable to determine/,
    );
  });

  it("generates one protected ephemeral secret file and cleans it up", async () => {
    const { directory, filePath } = await createEphemeralSecretsFile();
    try {
      const fileInfo = await stat(filePath);
      const payload = JSON.parse(await readFile(filePath, "utf8"));
      const secret = payload.CRM_SYSTEM_GATEWAY_SECRET;

      assert.equal(fileInfo.mode & 0o777, 0o600);
      assert.equal(typeof secret, "string");
      assert.equal(Buffer.from(secret, "base64url").length, 32);
      assert.deepEqual(Object.keys(payload), ["CRM_SYSTEM_GATEWAY_SECRET"]);
      assert.deepEqual(
        buildSecretsFileArgs(filePath, repositoryRoot),
        ["--secrets-file", filePath],
      );
      assert.doesNotMatch(
        buildSecretsFileArgs(filePath, repositoryRoot).join(" "),
        new RegExp(secret),
      );
    } finally {
      await removeEphemeralSecretsFile(directory);
    }

    await assert.rejects(stat(filePath));
  });

  it("refuses repository-local secret files", () => {
    assert.throws(
      () =>
        buildSecretsFileArgs(
          `${repositoryRoot}/.bootstrap-secrets.json`,
          repositoryRoot,
        ),
      /outside the repository/,
    );
  });

  it("keeps normal deploy secret validation and bootstrap-only secrets-file use", async () => {
    const normalGatewayDeploy = await readFile(
      `${repositoryRoot}/scripts/deploy-mail-files-production.mjs`,
      "utf8",
    );
    const crmDeploy = await readFile(
      `${repositoryRoot}/scripts/deploy-production.mjs`,
      "utf8",
    );
    const bootstrap = await readFile(
      `${repositoryRoot}/scripts/bootstrap-mail-files-production.mjs`,
      "utf8",
    );

    assert.match(normalGatewayDeploy, /assertGatewaySecretExists/);
    assert.doesNotMatch(normalGatewayDeploy, /--secrets-file/);
    assert.match(crmDeploy, /opennextjs-cloudflare",\s*"deploy"/);
    assert.match(crmDeploy, /--secrets-file/);
    assert.doesNotMatch(crmDeploy, /wrangler",\s*"deploy"/);
    assert.match(bootstrap, /buildSecretsFileArgs/);
    assert.doesNotMatch(bootstrap, /secret\s+put/);
    assert.doesNotMatch(
      bootstrap,
      /console\.(?:log|error)[\s\S]{0,100}\$\{(?:secret|filePath)\}/i,
    );
    assert.doesNotMatch(crmDeploy, /CRM_SYSTEM_GATEWAY_SECRET.*metadata/i);
  });
});
