import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  createPendingNotificationIdentity,
  sendNotificationIdentityVerificationChallenge,
} from "@/lib/mail/notification-identity-service";
import {
  claimNotificationOutboxForProcessing,
} from "@/lib/mail/notification-outbox-processing-service";
import {
  createCapturingNotificationVerificationChallengeSink,
} from "@/lib/mail/notification-verification-challenge-sink";
import {
  processClaimedVerificationOutboxDelivery,
} from "@/lib/mail/notification-verification-outbox-processing-service";
import {
  MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR,
} from "@/lib/mail/notification-verification-transport";
import {
  MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR,
} from "@/lib/mail/notification-verification-secret";
import { SYSTEM_MAIL_ACTOR } from "@/lib/mail/system-mail-actor";
import {
  buildMailBackgroundTickDeps,
  type MailJobsEnv,
} from "./mail-jobs-cron";

const FIXTURE = "mail-jobs-verification-secret-runtime";
const TARGET_USER = SEED_IDS.staffA;
const WORKER_ENV_SECRET = "mail-jobs-runtime-worker-env-secret-only";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(userId: string): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: "staff",
    mailAccessEnabled: true,
    adminGrants: ["permission_mgmt"],
    audit: { ipAddress: "127.0.0.1", userAgent: FIXTURE },
  };
}

function fixtureEmail(localPart: string): string {
  return `${FIXTURE}-${localPart}@example.com`;
}

async function cleanupFixtures(db: TestDb) {
  const outboxRows = await db
    .select({ id: schema.mailNotificationOutbox.id })
    .from(schema.mailNotificationOutbox)
    .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
  for (const row of outboxRows) {
    await db
      .delete(schema.mailNotificationAttempts)
      .where(eq(schema.mailNotificationAttempts.notificationOutboxId, row.id));
  }
  await db
    .delete(schema.mailNotificationOutbox)
    .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
  await db
    .delete(schema.mailNotificationIdentities)
    .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
}

describe("standalone mail-jobs verification secret runtime", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;
  const previousTestDbBind = process.env.CRM_ALLOW_TEST_DB_BIND;
  const previousVerificationMode =
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR];
  const previousVerificationSecret =
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] =
      "setup-only-verification-secret";
    const proxy = await getPlatformProxy({
      configPath: "./wrangler.jsonc",
      persist: { path: ".wrangler/state/v3" },
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    dispose?.();
    process.env.CRM_ALLOW_TEST_DB_BIND = previousTestDbBind;
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] =
      previousVerificationMode;
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] =
      previousVerificationSecret;
  });

  beforeEach(async () => {
    await cleanupFixtures(db);
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
  });

  afterEach(async () => {
    await cleanupFixtures(db);
  });

  it("standalone mail-jobs generates verification challenge from Worker env secret without OpenNext context", async () => {
    const permissionActor = actor(SEED_IDS.staffB);
    const email = fixtureEmail("runtime-secret");
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email,
    });
    await sendNotificationIdentityVerificationChallenge(
      db,
      permissionActor,
      TARGET_USER,
    );
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    assert.ok(outbox);

    delete process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];

    const capture = createCapturingNotificationVerificationChallengeSink();
    const mailJobsEnv = {
      DB: {} as D1Database,
      ATTACHMENTS: {} as R2Bucket,
      MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE: "production",
      MAIL_NOTIFICATION_VERIFICATION_SECRET: WORKER_ENV_SECRET,
      CLOUDFLARE_EMAIL_SENDING_API_TOKEN: "runtime-test-token",
      CLOUDFLARE_EMAIL_SENDING_ACCOUNT_ID: "runtime-test-account-id",
    } satisfies MailJobsEnv;

    const deps = buildMailBackgroundTickDeps(mailJobsEnv);
    deps.verificationChallengeSink = capture.sink;

    assert.equal(deps.verificationChallengeSecret, WORKER_ENV_SECRET);
    assert.ok(deps.verificationChallengeSink);

    const stageLogs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      if (args[0] === "[verification-delivery]" && typeof args[1] === "string") {
        const parsed = JSON.parse(args[1]) as { stage?: string };
        if (parsed.stage) {
          stageLogs.push(parsed.stage);
        }
      }
      originalLog(...args);
    };

    try {
      const claim = await claimNotificationOutboxForProcessing(db, {
        outboxId: outbox.id,
      });
      assert.equal(claim.claimed, true);

      const processed = await processClaimedVerificationOutboxDelivery(
        db,
        SYSTEM_MAIL_ACTOR,
        {
          outboxId: outbox.id,
          sink: deps.verificationChallengeSink!,
          verificationSecret: deps.verificationChallengeSecret!,
        },
      );

      assert.equal(processed.outcome, "sent");
      assert.ok(capture.latestToken());
      assert.ok(stageLogs.includes("ATTEMPT_INSERTED"));
      assert.ok(stageLogs.includes("CHALLENGE_GENERATION_STARTED"));
      assert.ok(stageLogs.includes("CHALLENGE_GENERATED"));
      assert.ok(stageLogs.includes("ATTEMPT_FINALIZED"));
    } finally {
      console.log = originalLog;
      process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] =
        previousVerificationSecret;
    }
  });
});
