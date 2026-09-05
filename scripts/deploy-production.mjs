import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  assertProductionSource,
  assertReleaseArtifact,
  readReleaseMetadata,
} from "./production-release-guard.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const openNextDirectory = resolve(repositoryRoot, ".open-next");
const releaseMetadataPath = resolve(openNextDirectory, ".release-meta.json");
const workerName = "crm-system";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...options.env },
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

export async function deployProduction() {
  run("git", ["fetch", "origin", "main", "--quiet"]);
  const source = productionSourceSnapshot();
  assertProductionSource(source);

  await rm(openNextDirectory, { recursive: true, force: true });
  run("npm", ["run", "generate:locales"], {
    env: { NEXT_PUBLIC_MAIL_READ_SOURCE: "production" },
  });
  run("npx", ["--no-install", "opennextjs-cloudflare", "build"], {
    env: { NEXT_PUBLIC_MAIL_READ_SOURCE: "production" },
  });

  const builtAt = new Date().toISOString();
  await mkdir(openNextDirectory, { recursive: true });
  await writeFile(
    releaseMetadataPath,
    `${JSON.stringify(
      {
        gitSha: source.head,
        builtAt,
        source: "production-release",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const metadata = await readReleaseMetadata(releaseMetadataPath);
  assertReleaseArtifact({
    metadata,
    head: source.head,
    originMain: source.originMain,
  });

  console.log(`Production release source SHA: ${source.head}`);
  console.log(`Production release artifact SHA: ${metadata.gitSha}`);
  console.log(`Production release build timestamp: ${metadata.builtAt}`);
  console.log(`Production release Worker target: ${workerName}`);
  console.log("Production release artifact validation: passed");

  run("npx", ["--no-install", "opennextjs-cloudflare", "deploy"], {
    env: { NEXT_PUBLIC_MAIL_READ_SOURCE: "production" },
  });
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  deployProduction().catch((error) => {
    console.error(
      `Production release blocked: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
