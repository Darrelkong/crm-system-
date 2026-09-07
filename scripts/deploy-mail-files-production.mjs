import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertProductionSource,
} from "./production-release-guard.mjs";
import {
  GATEWAY_CONFIG_PATH,
  GATEWAY_SECRET_NAME,
  GATEWAY_WORKER_NAME,
  assertGatewayProductionConfig,
  readGatewayProductionConfig,
} from "./mail-files-production-guard.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}.`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}.`);
  }
  return result.stdout;
}

function productionSourceSnapshot() {
  return {
    branch: capture("git", ["branch", "--show-current"]).trim(),
    head: capture("git", ["rev-parse", "HEAD"]).trim(),
    originMain: capture("git", ["rev-parse", "origin/main"]).trim(),
    status: capture("git", [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
    packageDiff: capture("git", [
      "diff",
      "--no-ext-diff",
      "HEAD",
      "--",
      "package.json",
      "package-lock.json",
    ]),
  };
}

function assertGatewaySecretExists() {
  const raw = capture("npx", [
    "--no-install",
    "wrangler",
    "secret",
    "list",
    "--name",
    GATEWAY_WORKER_NAME,
    "--format",
    "json",
  ]);
  let secrets;
  try {
    secrets = JSON.parse(raw);
  } catch {
    throw new Error("Unable to parse Gateway secret metadata.");
  }
  if (
    !Array.isArray(secrets) ||
    !secrets.some((secret) => secret?.name === GATEWAY_SECRET_NAME)
  ) {
    throw new Error(
      `Required Gateway secret ${GATEWAY_SECRET_NAME} is not configured.`,
    );
  }
}

export async function deployMailFilesProduction() {
  run("git", ["fetch", "origin", "main", "--quiet"]);
  const source = productionSourceSnapshot();
  assertProductionSource(source);

  const { config, source: configSource } =
    await readGatewayProductionConfig(repositoryRoot);
  assertGatewayProductionConfig(config, configSource);
  assertGatewaySecretExists();

  console.log(`Gateway Production source SHA: ${source.head}`);
  console.log(`Gateway Production config: ${GATEWAY_CONFIG_PATH}`);
  console.log(`Gateway Production Worker: ${GATEWAY_WORKER_NAME}`);
  console.log("Gateway Production guard validation: passed");

  run("npx", [
    "--no-install",
    "wrangler",
    "deploy",
    "--config",
    GATEWAY_CONFIG_PATH,
  ]);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  deployMailFilesProduction().catch((error) => {
    console.error(
      `Gateway Production release blocked: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
