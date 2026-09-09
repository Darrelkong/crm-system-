import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const configPath = resolve(
  repositoryRoot,
  "wrangler.knowledge-preview.jsonc",
);

const PREVIEW_WORKER = "crm-system-knowledge-preview";
const PREVIEW_DATABASE = "crm-db-knowledge-preview";
const PREVIEW_BUCKET = "crm-knowledge-sources-preview";
const PRODUCTION_DATABASE_ID = "03633dd2-c058-42de-9355-f5450eab7202";
const PRODUCTION_NAMES = new Set([
  "crm-system",
  "crm-db",
  "crm-attachments",
  "crm-mail-large-attachments",
  "echfront-mail-files",
  "crm-system-mail-jobs-cron",
  "crm.echfronthk.com",
  "files.echfronthk.com",
]);

function fail(message) {
  throw new Error(`Knowledge preview deployment blocked: ${message}`);
}

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

function readConfig() {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function validateKnowledgePreviewConfig({
  config = readConfig(),
  branch,
  head,
  status,
} = {}) {
  if (branch !== "feat/knowledge-human-acceptance-preview") {
    fail(`wrong branch (${branch ?? "unknown"})`);
  }
  if (status) fail("worktree is not clean");
  if (!head) fail("unable to resolve current HEAD");
  if (config.name !== PREVIEW_WORKER) {
    fail(`worker name must be ${PREVIEW_WORKER}`);
  }
  if (config.routes?.length || config.send_email || config.triggers) {
    fail("routes, email bindings, and cron triggers are forbidden");
  }
  if (config.workers_dev !== false || config.preview_urls !== false) {
    fail("workers.dev and preview URLs must be disabled");
  }

  const databases = config.d1_databases ?? [];
  if (
    databases.length !== 1 ||
    databases[0].binding !== "DB" ||
    databases[0].database_name !== PREVIEW_DATABASE ||
    !databases[0].database_id ||
    databases[0].database_id === "__PREVIEW_D1_ID__" ||
    databases[0].database_id === PRODUCTION_DATABASE_ID
  ) {
    fail("D1 binding is not an isolated preview database");
  }

  const buckets = config.r2_buckets ?? [];
  if (
    buckets.length !== 1 ||
    buckets[0].binding !== "KNOWLEDGE_SOURCES" ||
    buckets[0].bucket_name !== PREVIEW_BUCKET
  ) {
    fail("R2 bindings are not limited to the isolated Knowledge bucket");
  }

  const resourceValues = [
    config.name,
    ...(config.d1_databases ?? []).flatMap((database) => [
      database.database_name,
      database.database_id,
    ]),
    ...(config.r2_buckets ?? []).map((bucket) => bucket.bucket_name),
    ...(config.services ?? []).map((service) => service.service),
    ...(config.routes ?? []).map((route) => route.pattern),
  ];
  for (const productionName of PRODUCTION_NAMES) {
    if (resourceValues.includes(productionName)) {
      fail(`production resource reference detected: ${productionName}`);
    }
  }
  if (
    config.vars?.CRM_ALLOW_MOCK_AI !== "1" ||
    config.vars?.MAIL_NOTIFICATION_TRANSPORT_ENABLED !== "false" ||
    config.vars?.MAIL_OUTBOUND_TRANSPORT_MODE !== "disabled" ||
    config.vars?.MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED !== "false" ||
    config.vars?.MAIL_LARGE_ATTACHMENT_SEND_ENABLED !== "false"
  ) {
    fail("mock AI or mail side-effect safeguards are missing");
  }
  return true;
}

function gitOutput(args) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed.`);
  }
  return result.stdout.trim();
}

export function validateCurrentKnowledgePreview() {
  return validateKnowledgePreviewConfig({
    branch: gitOutput(["branch", "--show-current"]),
    head: gitOutput(["rev-parse", "HEAD"]),
    status: gitOutput(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    validateCurrentKnowledgePreview();
    if (process.argv.includes("--check")) {
      console.log("Knowledge preview deployment guard: passed");
      process.exit(0);
    }
    run("npm", ["run", "generate:locales"], {
      env: { NEXT_PUBLIC_MAIL_READ_SOURCE: "preview" },
    });
    run("npx", ["--no-install", "opennextjs-cloudflare", "build"], {
      env: { NEXT_PUBLIC_MAIL_READ_SOURCE: "preview" },
    });
    validateCurrentKnowledgePreview();
    run("npx", [
      "--no-install",
      "wrangler",
      "deploy",
      "--config",
      "wrangler.knowledge-preview.jsonc",
    ]);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  }
}
