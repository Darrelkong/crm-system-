import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { MailBackgroundTickSummary } from "../src/lib/mail/mail-background-tick-service";
import {
  buildMailBackgroundTickDeps,
  formatMailJobsTickLogSummary,
  isMailNotificationTransportEnabled,
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
    verificationDispatch: { ...counters },
    verificationDispatchSkipped: true,
    rawPayloadRetention: {
      eligible: 0,
      purged: 0,
      alreadyMissing: 0,
      skipped: 0,
      errors: 0,
    },
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
    assert.match(config, /"send_email"/);
    assert.match(config, /"name":\s*"EMAIL"/);
    assert.match(
      config,
      /"allowed_sender_addresses":\s*\[\s*"notifications@send\.echfronthk\.com"\s*\]/,
    );
    assert.match(
      config,
      /"MAIL_NOTIFICATION_TRANSPORT_ENABLED":\s*"false"/,
    );
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

  it("worker source wires verification REST transport for production mode", () => {
    const worker = read("workers/mail-jobs-cron.ts");
    assert.match(worker, /createEmailNotificationVerificationChallengeSink/);
    assert.match(worker, /resolveCloudflareEmailServiceRestVerificationTransportConfig/);
    assert.match(worker, /CLOUDFLARE_EMAIL_SENDING_API_TOKEN/);
    assert.doesNotMatch(worker, /createEmailNotificationVerificationChallengeSink\(\s*env\.EMAIL/);
  });

  it("worker source wires verification secret from Worker env into tick deps", () => {
    const worker = read("workers/mail-jobs-cron.ts");
    assert.match(worker, /MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR/);
    assert.match(worker, /requireNotificationVerificationSecretFromEnv/);
    assert.match(worker, /verificationChallengeSecret/);
    assert.doesNotMatch(worker, /process\.env\[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR\]/);
  });

  it("worker source wires Cloudflare notification transport behind explicit flag only", () => {
    const worker = read("workers/mail-jobs-cron.ts");
    assert.doesNotMatch(worker, /FakeNotificationTransportAdapter/);
    assert.match(worker, /createCloudflareEmailNotificationTransport/);
    assert.match(worker, /MAIL_NOTIFICATION_TRANSPORT_ENABLED/);
    assert.match(worker, /isMailNotificationTransportEnabled/);
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

  it("no migration references or notification provider secrets in mail jobs config", () => {
    const config = read("wrangler.mail-jobs-cron.jsonc");
    const worker = read("workers/mail-jobs-cron.ts");
    assert.doesNotMatch(config, /BREVO|RESEND|POSTMARK|SMTP|API_KEY/);
    assert.doesNotMatch(config, /0067|wire_internet_message_id/);
    assert.doesNotMatch(worker, /0067|wire_internet_message_id/);
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

  it("does not provide NotificationTransportAdapter when transport flag is disabled", async () => {
    let capturedTransport: unknown = "unset";
    const env = {
      DB: {} as D1Database,
      ATTACHMENTS: {} as R2Bucket,
      EMAIL: {} as SendEmail,
      MAIL_NOTIFICATION_TRANSPORT_ENABLED: "false",
    } satisfies MailJobsEnv;

    await runMailJobsScheduledTick(env, {
      runTick: async (_db, deps) => {
        capturedTransport = deps.notificationTransport;
        return emptySummary();
      },
    });

    assert.equal(capturedTransport, undefined);
  });

  it("provides verification REST sink when verification transport mode is production", () => {
    const env = {
      DB: {} as D1Database,
      ATTACHMENTS: {} as R2Bucket,
      MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE: "production",
      MAIL_NOTIFICATION_VERIFICATION_SECRET: "mail-jobs-test-verification-secret",
      CLOUDFLARE_EMAIL_SENDING_API_TOKEN: "test-token",
      CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID: "test-account-id",
    } satisfies MailJobsEnv;

    const deps = buildMailBackgroundTickDeps(env);
    assert.ok(deps.verificationChallengeSink);
    assert.equal(
      deps.verificationChallengeSecret,
      "mail-jobs-test-verification-secret",
    );
  });

  it("fails clearly when verification secret is missing for production transport", () => {
    const env = {
      DB: {} as D1Database,
      ATTACHMENTS: {} as R2Bucket,
      MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE: "production",
      CLOUDFLARE_EMAIL_SENDING_API_TOKEN: "test-token",
      CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID: "test-account-id",
    } satisfies MailJobsEnv;

    assert.throws(
      () => buildMailBackgroundTickDeps(env),
      /MAIL_NOTIFICATION_VERIFICATION_SECRET secret when MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE is production/,
    );
  });

  it("fails clearly when verification secret is blank for production transport", () => {
    const env = {
      DB: {} as D1Database,
      ATTACHMENTS: {} as R2Bucket,
      MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE: "production",
      MAIL_NOTIFICATION_VERIFICATION_SECRET: "   ",
      CLOUDFLARE_EMAIL_SENDING_API_TOKEN: "test-token",
      CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID: "test-account-id",
    } satisfies MailJobsEnv;

    assert.throws(
      () => buildMailBackgroundTickDeps(env),
      /MAIL_NOTIFICATION_VERIFICATION_SECRET secret when MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE is production/,
    );
  });

  it("fails clearly when verification REST transport config is missing", () => {
    const env = {
      DB: {} as D1Database,
      ATTACHMENTS: {} as R2Bucket,
      MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE: "production",
    } satisfies MailJobsEnv;

    assert.throws(
      () => buildMailBackgroundTickDeps(env),
      /CLOUDFLARE_EMAIL_SENDING_API_TOKEN secret and CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID/,
    );
  });

  it("does not require EMAIL binding for verification-only production transport", () => {
    const env = {
      DB: {} as D1Database,
      ATTACHMENTS: {} as R2Bucket,
      MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE: "production",
      MAIL_NOTIFICATION_VERIFICATION_SECRET: "mail-jobs-test-verification-secret",
      CLOUDFLARE_EMAIL_SENDING_API_TOKEN: "test-token",
      CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID: "test-account-id",
    } satisfies MailJobsEnv;

    const deps = buildMailBackgroundTickDeps(env);
    assert.ok(deps.verificationChallengeSink);
    assert.equal(deps.notificationTransport, undefined);
  });

  it("provides Cloudflare notification transport only when flag is enabled", () => {
    const env = {
      DB: {} as D1Database,
      ATTACHMENTS: {} as R2Bucket,
      EMAIL: { send: async () => ({ messageId: "msg-test" }) } as SendEmail,
      MAIL_NOTIFICATION_TRANSPORT_ENABLED: "true",
    } satisfies MailJobsEnv;

    const deps = buildMailBackgroundTickDeps(env);
    assert.ok(deps.notificationTransport);
    assert.equal(deps.notificationTransport?.providerId, "cloudflare-email-sending");
  });

  it("fails clearly when transport flag is enabled without EMAIL binding", () => {
    const env = {
      DB: {} as D1Database,
      ATTACHMENTS: {} as R2Bucket,
      MAIL_NOTIFICATION_TRANSPORT_ENABLED: "true",
    } satisfies MailJobsEnv;

    assert.throws(
      () => buildMailBackgroundTickDeps(env),
      /EMAIL send_email binding/,
    );
  });

  it("treats missing transport flag as disabled", () => {
    assert.equal(isMailNotificationTransportEnabled({}), false);
    assert.equal(
      isMailNotificationTransportEnabled({
        MAIL_NOTIFICATION_TRANSPORT_ENABLED: undefined,
      }),
      false,
    );
    assert.equal(
      isMailNotificationTransportEnabled({
        MAIL_NOTIFICATION_TRANSPORT_ENABLED: "false",
      }),
      false,
    );
    assert.equal(
      isMailNotificationTransportEnabled({
        MAIL_NOTIFICATION_TRANSPORT_ENABLED: "true",
      }),
      true,
    );
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
