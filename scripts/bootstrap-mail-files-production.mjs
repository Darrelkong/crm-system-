import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deployProduction } from "./deploy-production.mjs";
import {
  BOOTSTRAP_DEPLOYMENT_CONTEXT,
  buildSecretsFileArgs,
  createEphemeralSecretsFile,
  readWorkerPresence,
  assertBootstrapPreconditions,
  removeEphemeralSecretsFile,
} from "./mail-files-production-bootstrap.mjs";
import {
  GATEWAY_CONFIG_PATH,
  GATEWAY_WORKER_NAME,
  readGatewayProductionConfig,
} from "./mail-files-production-guard.mjs";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gatewayConfigPath = resolve(repositoryRoot, GATEWAY_CONFIG_PATH);
const crmConfigPath = resolve(repositoryRoot, "wrangler.jsonc");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}.`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
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

async function readProductionConfig() {
  const { config, source: gatewaySource } =
    await readGatewayProductionConfig(repositoryRoot);
  const crmSource = await readFile(crmConfigPath, "utf8");
  return { config, gatewaySource, crmSource };
}

async function assertFirstCreateState() {
  const source = productionSourceSnapshot();
  const { config, gatewaySource, crmSource } = await readProductionConfig();
  const gatewayExists = readWorkerPresence(
    repositoryRoot,
    GATEWAY_WORKER_NAME,
  );
  assertBootstrapPreconditions({
    source,
    gatewayConfig: config,
    gatewaySource,
    crmSource,
    gatewayExists,
  });
  return { source, config, gatewaySource, crmSource };
}

export async function bootstrapMailFilesProduction() {
  run("git", ["fetch", "origin", "main", "--quiet"]);
  const initial = await assertFirstCreateState();

  console.log(
    `Gateway bootstrap source SHA: ${initial.source.head}; first-create guard passed.`,
  );

  const { directory, filePath } = await createEphemeralSecretsFile();
  try {
    const secretsArgs = buildSecretsFileArgs(filePath, repositoryRoot);
    await deployProduction({
      secretsFile: filePath,
      authorization: BOOTSTRAP_DEPLOYMENT_CONTEXT,
    });

    const afterCrm = await assertFirstCreateState();
    if (afterCrm.source.head !== initial.source.head) {
      throw new Error(
        "Source revision changed during bootstrap; Gateway deployment stopped.",
      );
    }

    console.log("CRM Production deployment with bootstrap secret completed.");
    console.log("Gateway first-create deployment starting.");
    run("npx", [
      "--no-install",
      "wrangler",
      "deploy",
      "--config",
      gatewayConfigPath,
      ...secretsArgs,
    ]);
    console.log(
      "Gateway first-create deployment completed; secret status: CONFIGURED.",
    );
  } finally {
    await removeEphemeralSecretsFile(directory);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  bootstrapMailFilesProduction().catch((error) => {
    console.error(
      `Gateway bootstrap blocked: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
