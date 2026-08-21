import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, it } from "node:test";
import type { MailBackgroundTickSummary } from "../src/lib/mail/mail-background-tick-service";
import {
  formatMailJobsTickLogSummary,
  runMailJobsScheduledTick,
  type MailJobsEnv,
} from "./mail-jobs-cron";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(`${ROOT}/${path}`, "utf8");
}

/** Minutes fired by approved offset schedule `1-59/3 * * * *` (UTC). */
export function mailJobsCronFireMinutes(): number[] {
  const minutes: number[] = [];
  for (let m = 1; m <= 59; m += 3) {
    minutes.push(m);
  }
  return minutes;
}

function extractMailJobsCronExpression(config: string): string {
  const match = config.match(/"crons":\s*\[\s*"([^"]+)"/);
  assert.ok(match, "mail jobs cron expression not found");
  return match[1];
}

function emptySummary(): MailBackgroundTickSummary {
  const counters = {
    selected: 0,
    claimed: 0,
    completed: 0,
    recovered: 0,
    quarantined: 0,
    retryScheduled: 0,
    permanentFailed: 0,
    skipped: 0,
    errors: 0,
  };
  return {
    providerProcessingRecovery: { ...counters },
    notificationProcessingRecovery: { ...counters },
    inboundMaterialization: { ...counters },
    deliveryMaterialization: { ...counters },
    notificationDispatch: { ...counters },
    notificationDispatchSkipped: true,
    totalItemsStarted: 0,
  };
}

describe("mail jobs cron static config", () => {
  it("wrangler.mail-jobs-cron.jsonc uses isolated worker name and approved schedule", () => {
    const config = read("wrangler.mail-jobs-cron.jsonc");
    assert.match(config, /"name":\s*"crm-system-mail-jobs-cron"/);
    assert.match(config, /"main":\s*"workers\/mail-jobs-cron.ts"/);
    assert.match(config, /"crons":\s*\[\s*"1-59\/3 \* \* \* \*"\s*\]/);
    assert.doesNotMatch(config, /\*\/3 \* \* \* \*/);
    assert.match(config, /"binding":\s*"DB"/);
    assert.match(config, /"database_name":\s*"crm-db"/);
    assert.match(config, /"database_id":\s*"03633dd2-c058-42de-9355-f5450eab7202"/);
    assert.match(config, /"binding":\s*"ATTACHMENTS"/);
    assert.match(config, /"bucket_name":\s*"crm-attachments"/);
    assert.match(config, /"workers_dev":\s*false/);
    assert.match(config, /"preview_urls":\s*false/);
    assert.doesNotMatch(config, /"routes"/);
    assert.doesNotMatch(config, /"route"/);
    assert.doesNotMatch(config, /custom_domain/);
  });

  it("worker source has no fetch handler or privileged HTTP API", () => {
    const worker = read("workers/mail-jobs-cron.ts");
    assert.doesNotMatch(worker, /async fetch/);
    assert.match(worker, /async scheduled/);
  });

  it("main CRM wrangler config is unchanged by mail jobs worker addition", () => {
    const main = read("wrangler.jsonc");
    assert.match(main, /"name":\s*"crm-system"/);
    assert.match(main, /"main":\s*"\.open-next\/worker.js"/);
    assert.doesNotMatch(main, /mail-jobs-cron/);
  });

  it("worker source does not import fake notification transport", () => {
    const worker = read("workers/mail-jobs-cron.ts");
    assert.doesNotMatch(worker, /FakeNotificationTransportAdapter/);
    assert.doesNotMatch(worker, /notification-transport-adapter/);
    assert.match(worker, /runMailBackgroundTick/);
    assert.doesNotMatch(worker, /async fetch/);
  });

  it("package scripts declare future deploy and dry-run only", () => {
    const pkg = read("package.json");
    assert.match(pkg, /"cron:mail:deploy"/);
    assert.match(pkg, /"cron:mail:dry-run"/);
    assert.doesNotMatch(pkg, /postinstall[\s\S]*cron:mail:deploy/);
  });

  it("approved cron offset avoids minute 00 and 30 UTC collision windows", () => {
    const config = read("wrangler.mail-jobs-cron.jsonc");
    const expression = extractMailJobsCronExpression(config);
    assert.equal(expression, "1-59/3 * * * *");

    const minutes = mailJobsCronFireMinutes();
    assert.deepEqual(minutes, [
      1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55,
      58,
    ]);
    assert.ok(!minutes.includes(0));
    assert.ok(!minutes.includes(30));
  });

  it("no migration 0067 and no notification provider secrets in mail jobs config", () => {
    assert.equal(globSync("drizzle/migrations/0067*").length, 0);
    const config = read("wrangler.mail-jobs-cron.jsonc");
    assert.doesNotMatch(config, /BREVO|RESEND|POSTMARK|SMTP|API_KEY/);
  });
});

describe("mail jobs cron wiring", () => {
  it("one scheduled tick invocation calls runMailBackgroundTick exactly once", async () => {
    let calls = 0;
    const env = {
      DB: {} as D1Database,
      ATTACHMENTS: {} as R2Bucket,
    } satisfies MailJobsEnv;

    await runMailJobsScheduledTick(env, {
      runTick: async () => {
        calls += 1;
        return emptySummary();
      },
    });

    assert.equal(calls, 1);
  });

  it("does not provide NotificationTransportAdapter to the tick", async () => {
    let capturedTransport: unknown = "unset";
    const env = {
      DB: {} as D1Database,
      ATTACHMENTS: {} as R2Bucket,
    } satisfies MailJobsEnv;

    await runMailJobsScheduledTick(env, {
      runTick: async (_db, deps) => {
        capturedTransport = deps.notificationTransport;
        return emptySummary();
      },
    });

    assert.equal(capturedTransport, undefined);
  });

  it("fails clearly when DB binding is missing", async () => {
    await assert.rejects(
      () =>
        runMailJobsScheduledTick({
          DB: undefined as unknown as D1Database,
          ATTACHMENTS: {} as R2Bucket,
        }),
      /DB D1 binding/,
    );
  });

  it("fails clearly when ATTACHMENTS binding is missing", async () => {
    await assert.rejects(
      () =>
        runMailJobsScheduledTick({
          DB: {} as D1Database,
          ATTACHMENTS: undefined as unknown as R2Bucket,
        }),
      /ATTACHMENTS R2 binding/,
    );
  });

  it("formatMailJobsTickLogSummary omits sensitive transport fields", () => {
    const payload = formatMailJobsTickLogSummary(emptySummary(), 42);
    const json = JSON.stringify(payload);
    assert.doesNotMatch(json, /mime|MIME|subject|recipient|@/i);
    assert.equal(payload.durationMs, 42);
    assert.equal(payload.notificationDispatchSkipped, true);
  });
});
