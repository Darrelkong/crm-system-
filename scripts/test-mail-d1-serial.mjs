import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const defaultFiles = [
  "src/lib/mail/inbound-provider-staging.integration.test.ts",
  "src/lib/mail/delivery-event-materialization.integration.test.ts",
  "src/lib/mail/draft-attachment-service.integration.test.ts",
  "src/lib/mail/mail-customer-association.integration.test.ts",
  "src/lib/mail/mail-customer-context-resolver.integration.test.ts",
  "src/lib/mail/draft-outbound-revision.integration.test.ts",
  "src/lib/mail/mailbox-management.integration.test.ts",
];
const files = process.argv.slice(2);
const testFiles = files.length > 0 ? files : defaultFiles;
const testTimeoutMs = Number(process.env.CRM_TEST_TIMEOUT_MS ?? 120_000);
const testNamePattern = process.env.CRM_TEST_NAME_PATTERN;
const gatewayPort = Number(process.env.CRM_TEST_D1_PORT ?? 8799);
const wranglerCli = path.join(
  repoRoot,
  "node_modules",
  "wrangler",
  "wrangler-dist",
  "cli.js",
);
const seedSql = `
INSERT INTO users (
  id, email, display_name, password_hash, role, is_active,
  failed_login_attempts, locked_until, created_at, updated_at
) VALUES
  ('11111111-1111-1111-1111-111111111101', 'admin@isolated.test', 'Isolated Admin', '$isolated$', 'admin', 1, 0, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('11111111-1111-1111-1111-111111111102', 'staff-a@isolated.test', 'Isolated Staff A', '$isolated$', 'staff', 1, 0, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('11111111-1111-1111-1111-111111111103', 'staff-b@isolated.test', 'Isolated Staff B', '$isolated$', 'staff', 1, 0, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
`;

async function createIsolatedDatabase(persistPath) {
  await execFileAsync(
    "npx",
    [
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "crm-db",
      "--local",
      "--persist-to",
      persistPath,
      "--config",
      "wrangler.jsonc",
    ],
    {
      cwd: repoRoot,
      maxBuffer: 100 * 1024 * 1024,
      timeout: testTimeoutMs,
    },
  );
  const seedFile = path.join(persistPath, "mail-test-seed.sql");
  await writeFile(seedFile, seedSql, "utf8");
  try {
    await execFileAsync(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        "crm-db",
        "--local",
        "--persist-to",
        persistPath,
        "--file",
        seedFile,
        "--config",
        "wrangler.jsonc",
      ],
      {
        cwd: repoRoot,
        maxBuffer: 100 * 1024 * 1024,
        timeout: testTimeoutMs,
      },
    );
  } finally {
    await rm(seedFile, { force: true });
  }
}

async function stopProcess(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forceKill);
      resolve();
    };
    const forceKill = setTimeout(() => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The process group may already be gone.
        }
      }
      finish();
    }, 5_000);

    child.once("close", finish);
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      finish();
    }
  });
}

async function startD1Gateway(persistPath) {
  const child = spawn(
    process.execPath,
    [
      wranglerCli,
      "dev",
      "workers/mail-test-d1-gateway.ts",
      "--config",
      "wrangler.mail-test.jsonc",
      "--local",
      "--port",
      String(gatewayPort),
      "--persist-to",
      persistPath,
      "--show-interactive-dev-session=false",
      "--log-level",
      "error",
    ],
    {
      cwd: repoRoot,
      detached: true,
      env: { ...process.env, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const endpoint = `http://127.0.0.1:${gatewayPort}/`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint);
      if (response.status === 404 || response.status === 405) {
        return { child, endpoint };
      }
    } catch {
      // The Worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await stopProcess(child);
  throw new Error(`D1 gateway did not become ready:\n${output}`);
}

async function executeD1(endpoint, operation, statement) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, ...statement }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `D1 gateway request failed: ${response.status}`);
  }
  return payload;
}

async function verifyD1Integrity(endpoint) {
  const foreignKeys = await executeD1(endpoint, "all", {
    sql: "PRAGMA foreign_key_check",
    params: [],
  });
  const quickCheck = await executeD1(endpoint, "all", {
    sql: "PRAGMA quick_check",
    params: [],
  });
  if (foreignKeys.results.length !== 0) {
    throw new Error(`foreign_key_check failed: ${JSON.stringify(foreignKeys)}`);
  }
  if (quickCheck.results[0]?.quick_check !== "ok") {
    throw new Error(`quick_check failed: ${JSON.stringify(quickCheck)}`);
  }
}

async function runFile(file) {
  const persistPath = await mkdtemp(path.join(os.tmpdir(), "crm-mail-d1-"));
  let gateway;
  try {
    await createIsolatedDatabase(persistPath);
    gateway = await startD1Gateway(persistPath);
    await verifyD1Integrity(gateway.endpoint);
    const startedAt = new Date().toISOString();
    console.log(`[mail-d1] START ${file} ${startedAt}`);
    return await new Promise((resolve) => {
      let timedOut = false;
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "--test",
          "--test-concurrency=1",
          ...(testNamePattern
            ? ["--test-name-pattern", testNamePattern]
            : []),
          file,
        ],
        {
          detached: true,
          cwd: repoRoot,
          env: {
            ...process.env,
            CRM_ALLOW_TEST_DB_BIND: "1",
            CRM_TEST_D1_CONFIG_PATH: "wrangler.mail-test.jsonc",
            CRM_TEST_D1_HTTP_URL: gateway.endpoint,
            NODE_ENV: "test",
          },
          stdio: "inherit",
        },
      );

      const timeout = setTimeout(() => {
        timedOut = true;
        void stopProcess(child);
      }, testTimeoutMs);

      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        const endedAt = new Date().toISOString();
        resolve({
          code: code ?? 1,
          signal,
          timedOut,
          startedAt,
          endedAt,
        });
      });
    });
  } finally {
    if (gateway?.child) {
      await stopProcess(gateway.child);
    }
    await rm(persistPath, { recursive: true, force: true });
  }
}

let failed = 0;
for (const file of testFiles) {
  const result = await runFile(file);
  if (result.code === 0) {
    console.log(`[mail-d1] PASS ${file} ${result.endedAt}`);
  } else {
    failed += 1;
    console.error(`[mail-d1] FAIL ${file}`, {
      signal: result.signal,
      timedOut: result.timedOut,
    });
  }
}

process.exitCode = failed === 0 ? 0 : 1;
