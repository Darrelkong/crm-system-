import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertGatewayProductionConfig,
  readGatewayProductionConfig,
} from "./mail-files-production-guard.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const featureBranch = "feat/mail-large-attachment-v1";
const requiredFiles = [
  "wrangler.echfronthk-mail-files.production.jsonc",
  "scripts/deploy-mail-files-production.mjs",
  "scripts/mail-files-production-guard.mjs",
  "docs/large-attachment/PRODUCTION_RELEASE_PHASE_A.md",
  "drizzle/migrations/0074_mail_large_attachment_acknowledgements.sql",
  "drizzle/migrations/0075_mail_large_attachment_delivery_tokens.sql",
];

function captureGit(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function fail(message) {
  throw new Error(`Production precheck failed: ${message}`);
}

async function assertFlags() {
  const wrangler = await readFile(resolve(repositoryRoot, "wrangler.jsonc"), "utf8");
  const mailJobs = await readFile(
    resolve(repositoryRoot, "wrangler.mail-jobs-cron.jsonc"),
    "utf8",
  );
  for (const [name, value] of [
    ["MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED", "false"],
    ["MAIL_LARGE_ATTACHMENT_SEND_ENABLED", "false"],
    ["MAIL_LARGE_ATTACHMENT_PUBLIC_BASE_URL", "https://files.echfronthk.com"],
  ]) {
    if (
      !new RegExp(
        `"${name}"\\s*:\\s*"${value.replaceAll(".", "\\.")}"`,
      ).test(wrangler)
    ) {
      fail(`wrangler.jsonc does not retain ${name}=${value}.`);
    }
  }
  if (
    !/"MAIL_LARGE_ATTACHMENT_SEND_ENABLED"\s*:\s*"false"/.test(mailJobs) ||
    !/"MAIL_LARGE_ATTACHMENT_PUBLIC_BASE_URL"\s*:\s*"https:\/\/files\.echfronthk\.com"/.test(
      mailJobs,
    )
  ) {
    fail("Mail Jobs Production defaults are not disabled and pointed at files.echfronthk.com.");
  }
}

async function assertMigrations() {
  for (const migration of requiredFiles.filter((file) =>
    file.startsWith("drizzle/"),
  )) {
    const source = await readFile(resolve(repositoryRoot, migration), "utf8");
    if (
      !/CREATE TABLE/i.test(source) ||
      /^\s*(?:DROP TABLE|ALTER TABLE|DELETE FROM|UPDATE)\b/im.test(source)
    ) {
      fail(`${migration} is not additive-only.`);
    }
  }
}

function assertSourceState() {
  const branch = captureGit(["branch", "--show-current"]);
  if (branch !== "main" && branch !== featureBranch) {
    fail(`unexpected release branch ${branch || "(detached)"}.`);
  }
  const head = captureGit(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/i.test(head)) fail("HEAD is not a full SHA.");
  const expected = process.env.MAIL_RELEASE_EXPECTED_SHA;
  if (expected && head !== expected) {
    fail(`HEAD ${head} does not match MAIL_RELEASE_EXPECTED_SHA ${expected}.`);
  }
  const status = captureGit([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status) fail("worktree is not clean.");
  const ancestor = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", "origin/main", "HEAD"],
    { cwd: repositoryRoot },
  );
  if (ancestor.status !== 0) {
    fail("origin/main is not an ancestor of the release source.");
  }
  return { branch, head };
}

async function assertFilesAndConfig() {
  for (const file of requiredFiles) {
    try {
      await readFile(resolve(repositoryRoot, file));
    } catch {
      fail(`required release file is missing: ${file}.`);
    }
  }
  const { config, source } = await readGatewayProductionConfig(repositoryRoot);
  assertGatewayProductionConfig(config, source);
  if (/mail-test|local-large-attachment|crm-system-local/i.test(source)) {
    fail("local/test Gateway config leaked into Production config.");
  }

  const packageJson = JSON.parse(
    await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
  );
  if (
    packageJson.scripts?.["deploy:mail-files:production"] !==
    "node scripts/deploy-mail-files-production.mjs"
  ) {
    fail("canonical Gateway Production deploy script is missing.");
  }

  const trackedAndUntracked = captureGit([
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  const forbidden = trackedAndUntracked
    .split("\n")
    .filter((file) =>
      /(^|\/)(?:\.env(?:\.(?:local|production))?|\.dev\.vars|\.wrangler)(?:\/|$)/i.test(
        file,
      ),
    );
  if (forbidden.length) {
    fail(`local configuration leakage detected: ${forbidden.join(", ")}`);
  }
}

async function run() {
  const state = assertSourceState();
  await assertFilesAndConfig();
  await assertFlags();
  await assertMigrations();
  console.log(`Production precheck passed for ${state.branch} at ${state.head}.`);
  console.log("No deployment, migration, secret, DNS, Access, CORS, or Cloudflare mutation was performed.");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
