import { spawn } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const sharedPersistPath = path.join(repoRoot, ".wrangler", "state", "v3");

async function runFile(file) {
  const persistPath = await mkdtemp(path.join(os.tmpdir(), "crm-mail-d1-"));
  for (const entry of await readdir(sharedPersistPath)) {
    await cp(
      path.join(sharedPersistPath, entry),
      path.join(persistPath, entry),
      { recursive: true },
    );
  }
  const startedAt = new Date().toISOString();
  console.log(`[mail-d1] START ${file} ${startedAt}`);
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--test", "--test-concurrency=1", file],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          CRM_ALLOW_TEST_DB_BIND: "1",
          CRM_TEST_D1_PERSIST_PATH: persistPath,
          NODE_ENV: "test",
        },
        stdio: "inherit",
      },
    );

    child.once("exit", (code, signal) => {
      const endedAt = new Date().toISOString();
      void rm(persistPath, { recursive: true, force: true }).finally(() => {
        resolve({ code: code ?? 1, signal, startedAt, endedAt });
      });
    });
  });
}

let failed = 0;
for (const file of testFiles) {
  const result = await runFile(file);
  if (result.code === 0) {
    console.log(`[mail-d1] PASS ${file} ${result.endedAt}`);
  } else {
    failed += 1;
    console.error(
      `[mail-d1] FAIL ${file}${result.signal ? ` (${result.signal})` : ""}`,
    );
  }
}

process.exitCode = failed === 0 ? 0 : 1;
