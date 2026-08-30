import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../../../drizzle/schema";
import { handlePostSendVerification } from "@/app/api/mail/access/[userId]/notification-identities/send-verification/route";
import {
  actor,
  makeRequireMailActor,
  setupMailReadApiDb,
  teardownMailReadApiDb,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { MAIL_ERROR_CODES } from "@/lib/mail/constants";
import {
  VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_MAX,
  createPendingNotificationIdentity,
} from "@/lib/mail/notification-identity-service";
import {
  isVerificationChallengeDeliveryFailure,
  NotificationVerificationChallengeDeliveryError,
} from "@/lib/mail/notification-verification-challenge-delivery";
import {
  createCapturingNotificationVerificationChallengeSink,
  type NotificationVerificationChallengeSink,
} from "@/lib/mail/notification-verification-challenge-sink";
import { NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS } from "@/lib/mail/notification-verification-challenge-policy";
import {
  MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR,
} from "@/lib/mail/notification-verification-secret";
import { verifyVerificationTokenHash } from "@/lib/mail/verification-token";

const FIXTURE = "mail-send-verification-route";
const TARGET_USER = SEED_IDS.staffA;
const permissionActor = actor(SEED_IDS.staffB, { adminGrants: ["permission_mgmt"] });

function fixtureEmail(localPart: string): string {
  return `${FIXTURE}-${localPart}@example.com`;
}

function createFailingVerificationSink(): NotificationVerificationChallengeSink {
  return {
    async deliverChallenge() {
      throw new Error("simulated provider temporary failure");
    },
  };
}

async function cleanupNotificationFixtures(db: TestDb) {
  await db
    .delete(schema.mailNotificationIdentities)
    .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
  await db
    .delete(schema.auditLogs)
    .where(eq(schema.auditLogs.userId, permissionActor.userId));
}

async function readPendingIdentity(db: TestDb) {
  const [row] = await db
    .select()
    .from(schema.mailNotificationIdentities)
    .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER))
    .limit(1);
  return row ?? null;
}

describe("POST /api/mail/access/[userId]/notification-identities/send-verification", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;
  let routeNowMs = Date.now();
  const previousSecret = process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];
  const testSecret = "send-verification-route-test-secret";

  before(async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] = testSecret;
    const setup = await setupMailReadApiDb();
    db = setup.db;
    dispose = setup.dispose;
  });

  beforeEach(async () => {
    routeNowMs = Date.parse("2026-08-30T08:00:00.000Z");
    await cleanupNotificationFixtures(db);
  });

  after(async () => {
    await cleanupNotificationFixtures(db);
    await teardownMailReadApiDb(db, dispose);
    if (previousSecret === undefined) {
      delete process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];
    } else {
      process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] = previousSecret;
    }
  });

  async function postSendVerification(
    capture?: ReturnType<typeof createCapturingNotificationVerificationChallengeSink>,
    sinkOverride?: NotificationVerificationChallengeSink,
  ) {
    const captureRef =
      capture ?? createCapturingNotificationVerificationChallengeSink();
    const res = await handlePostSendVerification(
      new Request(
        `http://localhost/api/mail/access/${TARGET_USER}/notification-identities/send-verification`,
        { method: "POST" },
      ),
      TARGET_USER,
      {
        requireMailActor: makeRequireMailActor(db, permissionActor),
        resolveChallengeSink: () => sinkOverride ?? captureRef.sink,
        nowMs: () => routeNowMs,
      },
    );
    return { res, capture: captureRef };
  }

  it("accepts the first send-verification request", async () => {
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("first"),
    });
    const { res, capture } = await postSendVerification();
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      delivery: { status: string };
    };
    assert.equal(json.delivery.status, "sent");
    assert.ok(capture.latestToken());
  });

  it("rejects an immediate second HTTP request within the 60s resend cooldown", async () => {
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("cooldown"),
    });
    const capture = createCapturingNotificationVerificationChallengeSink();
    const before = await readPendingIdentity(db);
    assert.ok(before);

    const first = await postSendVerification(capture);
    assert.equal(first.res.status, 200);
    const afterFirst = await readPendingIdentity(db);
    assert.ok(afterFirst?.verificationRequestedAt);

    const second = await postSendVerification(capture);
    assert.equal(second.res.status, 409);
    const body = (await second.res.json()) as {
      errorCode: string;
      metadata?: {
        verificationReason?: string;
        retryAfterSeconds?: number;
      };
    };
    assert.equal(body.errorCode, MAIL_ERROR_CODES.CONFLICT);
    assert.equal(body.metadata?.verificationReason, "resend_cooldown");
    assert.ok((body.metadata?.retryAfterSeconds ?? 0) > 0);

    const afterSecond = await readPendingIdentity(db);
    assert.equal(
      afterSecond?.verificationRequestedAt,
      afterFirst?.verificationRequestedAt,
    );
    assert.equal(afterSecond?.verificationTokenHash, afterFirst?.verificationTokenHash);
    assert.equal(afterSecond?.verificationAttemptCount, afterFirst?.verificationAttemptCount);
    assert.equal(capture.deliveries.length, 1);
  });

  it("keeps the old OTP valid after a rejected resend", async () => {
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("old-otp"),
    });
    const capture = createCapturingNotificationVerificationChallengeSink();
    const first = await postSendVerification(capture);
    assert.equal(first.res.status, 200);
    const firstToken = capture.latestToken();
    assert.ok(firstToken);
    const identity = await readPendingIdentity(db);
    assert.ok(identity);

    const second = await postSendVerification(capture);
    assert.equal(second.res.status, 409);

    const stillPending = await readPendingIdentity(db);
    assert.ok(stillPending?.verificationTokenHash);
    assert.equal(
      verifyVerificationTokenHash(
        stillPending.verificationTokenHash!,
        firstToken,
        identity.id,
        testSecret,
      ),
      true,
    );
  });

  it("propagates the 24h issue rate limit over HTTP", async () => {
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("rate-limit"),
    });
    for (let i = 0; i < VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_MAX; i += 1) {
      routeNowMs += NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS + 1_000;
      const { res } = await postSendVerification();
      assert.equal(res.status, 200, `expected success on issue ${i + 1}`);
    }

    routeNowMs += NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS + 1_000;
    const { res } = await postSendVerification();
    assert.equal(res.status, 409);
    const body = (await res.json()) as {
      error: string;
      errorCode: string;
      metadata?: { verificationReason?: string };
    };
    assert.equal(body.errorCode, MAIL_ERROR_CODES.CONFLICT);
    assert.equal(body.metadata?.verificationReason, undefined);
    assert.match(body.error, /rate limit/i);
  });

  it("does not convert resend_cooldown into delivery_failed", async () => {
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("not-delivery-failed"),
    });
    await postSendVerification();
    const { res } = await postSendVerification();
    assert.notEqual(res.status, 200);
    if (res.status === 200) {
      const json = (await res.json()) as { delivery?: { status?: string } };
      assert.notEqual(json.delivery?.status, "delivery_failed");
    }
  });

  it("returns delivery_failed for genuine provider delivery failures", async () => {
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("provider-fail"),
    });
    const before = await readPendingIdentity(db);
    assert.ok(before);
    const { res } = await postSendVerification(
      undefined,
      createFailingVerificationSink(),
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { delivery: { status: string } };
    assert.equal(json.delivery.status, "delivery_failed");
    const after = await readPendingIdentity(db);
    assert.equal(after?.verificationRequestedAt, before?.verificationRequestedAt);
    assert.equal(after?.verificationTokenHash, before?.verificationTokenHash);
  });

  it("rotates the challenge after cooldown and rejects the old OTP", async () => {
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("rotate"),
    });
    const capture = createCapturingNotificationVerificationChallengeSink();
    const first = await postSendVerification(capture);
    assert.equal(first.res.status, 200);
    const firstToken = capture.latestToken();
    assert.ok(firstToken);
    const identity = await readPendingIdentity(db);
    assert.ok(identity);

    routeNowMs += NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS + 1_000;
    const second = await postSendVerification(capture);
    assert.equal(second.res.status, 200);
    const secondToken = capture.latestToken();
    assert.ok(secondToken);
    assert.notEqual(secondToken, firstToken);

    const afterResend = await readPendingIdentity(db);
    assert.notEqual(afterResend?.verificationTokenHash, identity.verificationTokenHash);
    assert.equal(afterResend?.verificationAttemptCount, 0);

    assert.equal(
      verifyVerificationTokenHash(
        afterResend!.verificationTokenHash!,
        firstToken,
        identity.id,
        testSecret,
      ),
      false,
    );

    assert.equal(
      verifyVerificationTokenHash(
        afterResend!.verificationTokenHash!,
        secondToken,
        identity.id,
        testSecret,
      ),
      true,
    );
  });

  it("classifies wrapped delivery failures without swallowing unknown errors", () => {
    assert.equal(
      isVerificationChallengeDeliveryFailure(
        new NotificationVerificationChallengeDeliveryError(),
      ),
      true,
    );
    assert.equal(isVerificationChallengeDeliveryFailure(new Error("boom")), false);
  });
});
