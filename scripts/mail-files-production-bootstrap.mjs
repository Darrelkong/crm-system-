import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  assertProductionSource,
} from "./production-release-guard.mjs";
import {
  GATEWAY_SECRET_NAME,
  assertGatewayProductionConfig,
} from "./mail-files-production-guard.mjs";

export const BOOTSTRAP_DEPLOYMENT_CONTEXT = Symbol(
  "mail-files-production-bootstrap",
);

export class MailFilesProductionBootstrapError extends Error {
  constructor(message) {
    super(message);
    this.name = "MailFilesProductionBootstrapError";
  }
}

function fail(message) {
  throw new MailFilesProductionBootstrapError(message);
}

export function assertCrmProductionFlags(source) {
  for (const [name, value] of [
    ["MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED", "false"],
    ["MAIL_LARGE_ATTACHMENT_SEND_ENABLED", "false"],
    ["MAIL_LARGE_ATTACHMENT_PUBLIC_BASE_URL", "https://files.echfronthk.com"],
  ]) {
    const expected = new RegExp(
      `"${name}"\\s*:\\s*"${value.replaceAll(".", "\\.")}"`,
    );
    if (!expected.test(source)) {
      fail(`CRM Production config must retain ${name}=${value}.`);
    }
  }

  if (
    /"MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED"\s*:\s*"true"/.test(source) ||
    /"MAIL_LARGE_ATTACHMENT_SEND_ENABLED"\s*:\s*"true"/.test(source)
  ) {
    fail("CRM Production large-attachment runtime and send flags must be false.");
  }
}

export function assertBootstrapPreconditions({
  source,
  gatewayConfig,
  gatewaySource,
  crmSource,
  gatewayExists,
}) {
  assertProductionSource(source);

  assertGatewayProductionConfig(gatewayConfig, gatewaySource);
  assertCrmProductionFlags(crmSource);

  if (/localhost|127\.0\.0\.1|\blocal\b|\btest\b/i.test(gatewaySource)) {
    fail("Gateway Production config contains a local/test hostname or marker.");
  }

  if (gatewayExists) {
    fail(
      "Gateway bootstrap is first-create only; echfront-mail-files already exists.",
    );
  }
}

export function parseWorkerPresence({ status, stdout = "", stderr = "" }) {
  const output = `${stdout}\n${stderr}`;
  if (status !== 0) {
    if (/worker\s+"[^"]+"\s+not found/i.test(output)) {
      return false;
    }
    throw new MailFilesProductionBootstrapError(
      "Unable to determine whether the Gateway Worker exists.",
    );
  }

  let deployments;
  try {
    deployments = JSON.parse(stdout);
  } catch {
    fail("Unable to parse Gateway Worker deployment metadata.");
  }

  if (Array.isArray(deployments)) {
    return deployments.length > 0;
  }
  if (Array.isArray(deployments?.deployments)) {
    return deployments.deployments.length > 0;
  }
  fail("Gateway Worker deployment metadata has an unexpected shape.");
}

export function readWorkerPresence(
  repositoryRoot,
  workerName,
  execute = (command, args, options) =>
    spawnSync(command, args, {
      ...options,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
) {
  const result = execute(
    "npx",
    [
      "--no-install",
      "wrangler",
      "deployments",
      "list",
      "--name",
      workerName,
      "--json",
    ],
    { cwd: repositoryRoot },
  );
  if (result.error) {
    throw result.error;
  }
  return parseWorkerPresence({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

export function assertEphemeralSecretsFilePath(filePath, repositoryRoot) {
  if (!filePath || !isAbsolute(filePath)) {
    fail("Bootstrap secrets file must use an absolute path.");
  }

  const root = resolve(repositoryRoot);
  const resolvedFile = resolve(filePath);
  const relativePath = relative(root, resolvedFile);
  if (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  ) {
    fail("Bootstrap secrets file must be outside the repository.");
  }
}

export function buildSecretsFileArgs(filePath, repositoryRoot) {
  assertEphemeralSecretsFilePath(filePath, repositoryRoot);
  return ["--secrets-file", filePath];
}

export async function createEphemeralSecretsFile() {
  const directory = await mkdtemp(
    join(tmpdir(), "crm-system-mail-files-bootstrap-"),
  );
  const filePath = join(directory, "secrets.json");
  const secret = randomBytes(32).toString("base64url");
  await writeFile(
    filePath,
    `${JSON.stringify({ [GATEWAY_SECRET_NAME]: secret })}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  await chmod(filePath, 0o600);
  return { directory, filePath };
}

export async function removeEphemeralSecretsFile(directory) {
  await rm(directory, { recursive: true, force: true });
}
