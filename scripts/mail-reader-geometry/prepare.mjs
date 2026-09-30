/** LOCAL ONLY: creates a new disposable runtime; never reads private env files. */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.slice(2).join(" ") !== "--local") throw new Error("Only --local is supported");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtime = mkdtempSync(path.join(tmpdir(), "crm-mail-m1b-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|HOME|TMPDIR|USER|SHELL|LANG|LC_.*)$/.test(k)));
Object.assign(env, { WRANGLER_SEND_METRICS: "false", NEXT_TELEMETRY_DISABLED: "1" });
const archive = execFileSync("git", ["archive", "HEAD"], { cwd: repo, maxBuffer: 150 * 1024 * 1024 });
execFileSync("tar", ["-x", "-C", runtime], { input: archive });
symlinkSync(realpathSync(path.join(repo, "node_modules")), path.join(runtime, "node_modules"));
cpSync(path.join(repo, "scripts/mail-reader-geometry"), path.join(runtime, "scripts/mail-reader-geometry"), { recursive: true });
const vars = {
  MAIL_NOTIFICATION_TRANSPORT_ENABLED: "false", MAIL_OUTBOUND_TRANSPORT_MODE: "disabled",
  MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE: "disabled", MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED: "false",
  MAIL_LARGE_ATTACHMENT_SEND_ENABLED: "false",
};
const config = {
  name: "crm-mail-m1b-local-only", compatibility_date: "2026-09-01", compatibility_flags: ["nodejs_compat"],
  d1_databases: [{ binding: "DB", database_name: "m1b-local", database_id: "00000000-0000-4000-8000-0000000001b0", migrations_dir: "drizzle/migrations", remote: false }],
  r2_buckets: [{ binding: "ATTACHMENTS", bucket_name: "m1b-local-attachments", remote: false }], vars,
};
writeFileSync(path.join(runtime, "wrangler.jsonc"), JSON.stringify(config, null, 2));
writeFileSync(path.join(runtime, ".env.local"), ["NEXT_PUBLIC_MAIL_READ_SOURCE=production", "NEXT_TELEMETRY_DISABLED=1", ...Object.entries(vars).map(([k,v]) => `${k}=${v}`), ""].join("\n"));
const wrangler = path.join(runtime, "node_modules/wrangler/wrangler-dist/cli.js");
const migrationOutput = execFileSync(process.execPath, [wrangler, "d1", "migrations", "apply", "m1b-local", "--local", "--config", "wrangler.jsonc"], { cwd: runtime, env, maxBuffer: 30*1024*1024 });
writeFileSync(path.join(runtime, "migrations.log"), migrationOutput);
execFileSync(process.execPath, ["--import", "tsx", "scripts/mail-reader-geometry/seed.ts", "--local"], { cwd: runtime, env, stdio: "inherit" });
writeFileSync(path.join(runtime, "runtime-manifest.json"), JSON.stringify({ runtime, base: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), origin: "http://127.0.0.1:3299", config, layers: ["real MIME parser", "real inbound sanitizer", "canonical D1 fixture inserts", "real authenticated read API", "real Mail shell"] }, null, 2));
console.log(`M1B_RUNTIME=${runtime}`);
console.log("Start in this directory: npm run dev -- --webpack --hostname 127.0.0.1 --port 3299");
