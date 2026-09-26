import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const configPath = resolve(
  repositoryRoot,
  "wrangler.knowledge-preview.jsonc",
);

const PREVIEW_WORKER = "crm-system-knowledge-preview";
const PREVIEW_DATABASE = "crm-db-si2-preview";
const PREVIEW_BUCKET = "crm-knowledge-si2-preview";
const PREVIEW_HOSTNAME = "knowledge-preview.echfronthk.com";
const PREVIEW_ACCESS_TEAM_DOMAIN = "https://echfronthk.cloudflareaccess.com";
const PRODUCTION_DATABASE_ID = "03633dd2-c058-42de-9355-f5450eab7202";
const ALLOWED_DEPLOY_BRANCHES = new Set([
  "feat/knowledge-smart-ingest-2",
]);
const PREVIEW_AI_SERVICE = "crm-ai-si2-preview";
const PREVIEW_DATABASE_ID = "66f0e690-25d1-45d2-aa16-197c5e7f0802";
const PRODUCTION_NAMES = new Set([
  "crm-system",
  "crm-ai",
  "crm-knowledge-sources",
  "crm-db-knowledge-preview",
  "crm-knowledge-sources-preview",
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
  approvedHead,
  remoteHead,
  status,
} = {}) {
  if (!branch || !ALLOWED_DEPLOY_BRANCHES.has(branch)) {
    fail(`wrong branch (${branch ?? "unknown"})`);
  }
  if (status) fail("worktree is not clean");
  if (!/^[a-f0-9]{40}$/.test(approvedHead ?? "") || head !== approvedHead || remoteHead !== approvedHead) {
    fail("HEAD, explicit approved SHA and remote feature SHA must match");
  }
  if (config.account_id !== "809c05c9f500268e973938fd641eee39") fail("wrong account");
  const allowedKeys = new Set(["$schema", "name", "account_id", "main", "compatibility_date", "compatibility_flags", "workers_dev", "preview_urls", "routes", "observability", "assets", "services", "d1_databases", "r2_buckets", "vars"]);
  if (Object.keys(config).some(key => !allowedKeys.has(key))) fail("unexpected config/binding type");
  if (config.assets?.binding !== "ASSETS" || config.main !== ".open-next/worker.js") fail("unexpected asset/entry binding");
  if (config.name !== PREVIEW_WORKER) {
    fail(`worker name must be ${PREVIEW_WORKER}`);
  }
  const routes = config.routes ?? [];
  if (
    routes.length !== 1 ||
    routes[0].pattern !== PREVIEW_HOSTNAME ||
    routes[0].custom_domain !== true
  ) {
    fail(`only the Preview custom domain ${PREVIEW_HOSTNAME} is allowed`);
  }
  if (config.send_email || config.triggers) {
    fail("email bindings and cron triggers are forbidden");
  }
  if (config.workers_dev !== false || config.preview_urls !== false) {
    fail("workers.dev and preview URLs must be disabled");
  }

  const databases = config.d1_databases ?? [];
  if (
    databases.length !== 1 ||
    databases[0].binding !== "DB" ||
    databases[0].database_name !== PREVIEW_DATABASE ||
    databases[0].database_id !== PREVIEW_DATABASE_ID ||
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
  const services = config.services ?? [];
  if (services.length !== 2 || services.some(service => Object.keys(service).some(key => !["binding", "service"].includes(key))) ||
      services.filter(service => service.binding === "WORKER_SELF_REFERENCE" && service.service === PREVIEW_WORKER).length !== 1 ||
      services.filter(service => service.binding === "AI_SERVICE" && service.service === PREVIEW_AI_SERVICE).length !== 1) fail("unexpected service binding");
  if (Object.keys(databases[0]).some(key => !["binding", "database_name", "database_id", "migrations_dir"].includes(key)) ||
      Object.keys(buckets[0]).some(key => !["binding", "bucket_name"].includes(key))) fail("unexpected storage binding property");
  const allowedVars = new Set(["CRM_ALLOW_MOCK_AI", "CRM_ALLOW_TEST_DB_BIND", "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "KNOWLEDGE_AI_DAILY_LIMIT", "MAIL_NOTIFICATION_TRANSPORT_ENABLED", "MAIL_OUTBOUND_TRANSPORT_MODE", "MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE", "MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED", "MAIL_LARGE_ATTACHMENT_SEND_ENABLED"]);
  if (Object.keys(config.vars ?? {}).some(key => !allowedVars.has(key))) fail("unexpected variable");
  const aiBinding = services.find((service) => service.binding === "AI_SERVICE");
  if (!aiBinding || aiBinding.service !== PREVIEW_AI_SERVICE) {
    fail(`AI_SERVICE must bind to ${PREVIEW_AI_SERVICE} for real vision staging`);
  }

  if (
    config.vars?.CRM_ALLOW_MOCK_AI !== "0" ||
    config.vars?.CRM_ALLOW_TEST_DB_BIND !== "0" ||
    config.vars?.MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE !== "disabled" ||
    config.vars?.CF_ACCESS_TEAM_DOMAIN !== PREVIEW_ACCESS_TEAM_DOMAIN ||
    typeof config.vars?.CF_ACCESS_AUD !== "string" ||
    config.vars.CF_ACCESS_AUD.trim() === "" ||
    config.vars?.MAIL_NOTIFICATION_TRANSPORT_ENABLED !== "false" ||
    config.vars?.MAIL_OUTBOUND_TRANSPORT_MODE !== "disabled" ||
    config.vars?.MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED !== "false" ||
    config.vars?.MAIL_LARGE_ATTACHMENT_SEND_ENABLED !== "false"
  ) {
    fail("real-AI staging or mail side-effect safeguards are missing");
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

export function validateCurrentKnowledgePreview(approvedHead) {
  return validateKnowledgePreviewConfig({
    approvedHead,
    remoteHead: gitOutput(["ls-remote", "--heads", "origin", "refs/heads/feat/knowledge-smart-ingest-2"]).split(/\s+/)[0],
    branch: gitOutput(["branch", "--show-current"]),
    head: gitOutput(["rev-parse", "HEAD"]),
    status: gitOutput(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const shaIndex = process.argv.indexOf("--sha");
    const approvedHead = shaIndex >= 0 ? process.argv[shaIndex + 1] : undefined;
    validateCurrentKnowledgePreview(approvedHead);
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
    validateCurrentKnowledgePreview(approvedHead);
    writeFileSync(resolve(repositoryRoot, ".open-next/.preview-release-meta.json"), JSON.stringify({ sourceSha: approvedHead, environment: "si2-preview" }));
    run("npx", [
      "--no-install",
      "wrangler",
      "deploy",
      "--config",
      "wrangler.knowledge-preview.jsonc",
      "--tag", approvedHead,
    ]);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  }
}
