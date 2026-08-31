import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertNotificationIdentityResponseHasNoSecrets,
  toSafeNotificationIdentityAdminView,
} from "@/lib/mail/notification-identity-serialization";
import {
  createPendingNotificationIdentity,
  issueSelfVerificationTokenForAdminProof,
  listNotificationIdentitiesForAdmin,
  VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_MAX,
  verifyNotificationIdentity,
} from "@/lib/mail/notification-identity-service";
import { createCapturingNotificationVerificationChallengeSink } from "@/lib/mail/notification-verification-challenge-sink";
import {
  NOTIFICATION_VERIFICATION_EXPIRY_MS,
  NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS,
  isValidVerificationCodeFormat,
} from "@/lib/mail/notification-verification-challenge-policy";
import { hashVerificationToken } from "@/lib/mail/verification-token";
import {
  MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR,
} from "@/lib/mail/notification-verification-secret";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-phase2c12c3a-h322";
const RESEND_COOLDOWN_ADVANCE_MS =
  NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS + 1_000;
const PROOF_USER = SEED_IDS.staffA;
const OTHER_USER = SEED_IDS.staffB;

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailAdminPermission[],
  mailAccessEnabled = true,
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: "staff",
    mailAccessEnabled,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: FIXTURE },
  };
}

const superAdminActor = actor(PROOF_USER, ["super_admin"]);
const permissionMgmtActor = actor(PROOF_USER, ["permission_mgmt"]);
const deliveryHealthActor = actor(PROOF_USER, ["delivery_health"]);
const noMailAccessActor = actor(PROOF_USER, ["super_admin"], false);

function fixtureEmail(localPart: string): string {
  return `${FIXTURE}-${localPart}@example.com`;
}

async function enableMailAccess(db: TestDb, userId: string) {
  const now = new Date().toISOString();
  await db
    .insert(schema.mailUserAccess)
    .values({
      userId,
      isEnabled: 1,
      enabledAt: now,
      enabledBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.mailUserAccess.userId,
      set: { isEnabled: 1, disabledAt: null, updatedAt: now },
    });
}

async function createPendingForUser(
  db: TestDb,
  targetUserId: string,
  email: string,
) {
  return createPendingNotificationIdentity(db, permissionMgmtActor, {
    targetUserId,
    email,
  });
}

async function cleanupFixtures(db: TestDb) {
  for (const userId of [PROOF_USER, OTHER_USER]) {
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.userId, userId));
    await db
      .delete(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, userId));
  }
}

describe("admin verification token issue service", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;
  const previousVerificationSecret =
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] =
      "notification-verification-token-integration-secret";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await cleanupFixtures(db);
    await enableMailAccess(db, PROOF_USER);
    await enableMailAccess(db, OTHER_USER);
  });

  beforeEach(async () => {
    await cleanupFixtures(db);
  });

  after(async () => {
    await cleanupFixtures(db);
    dispose?.();
    if (previousVerificationSecret === undefined) {
      delete process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];
    } else {
      process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] =
        previousVerificationSecret;
    }
  });

  it("rejects proof token issue when actor has no pending self identity", async () => {
    await assert.rejects(
      () => issueSelfVerificationTokenForAdminProof(db, noMailAccessActor),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 400);
        assert.match(error.message, /pending notification identity/);
        return true;
      },
    );
  });

  it("rejects non-super-admin actor", async () => {
    await assert.rejects(
      () => issueSelfVerificationTokenForAdminProof(db, deliveryHealthActor),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 403);
        assert.match(error.message, /Super admin authority required/);
        return true;
      },
    );
  });

  it("rejects when actor has no pending self identity", async () => {
    await assert.rejects(
      () => issueSelfVerificationTokenForAdminProof(db, superAdminActor),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 400);
        assert.match(error.message, /pending notification identity/);
        return true;
      },
    );
  });

  it("does not issue for another user pending identity when actor has none", async () => {
    await createPendingForUser(db, OTHER_USER, fixtureEmail("other-pending"));

    await assert.rejects(
      () => issueSelfVerificationTokenForAdminProof(db, superAdminActor),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 400);
        return true;
      },
    );

    const [otherRow] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, OTHER_USER))
      .limit(1);
    assert.ok(otherRow);
    assert.equal(otherRow.verificationStatus, "pending");
  });

  it("issues 8-character OTP with identityId and 5-minute expiresAt", async () => {
    const pending = await createPendingForUser(
      db,
      PROOF_USER,
      fixtureEmail("issue"),
    );
    const issuedAtMs = Date.now();
    const result = await issueSelfVerificationTokenForAdminProof(
      db,
      superAdminActor,
      { nowMs: issuedAtMs },
    );
    assert.equal(result.item.identityId, pending.id);
    assert.match(result.item.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(result.verificationToken.length, 8);
    assert.equal(isValidVerificationCodeFormat(result.verificationToken), true);
    assert.equal(
      Date.parse(result.item.expiresAt),
      issuedAtMs + NOTIFICATION_VERIFICATION_EXPIRY_MS,
    );
  });

  it("persists token hash but not plaintext in D1", async () => {
    await createPendingForUser(db, PROOF_USER, fixtureEmail("persist"));
    const result = await issueSelfVerificationTokenForAdminProof(
      db,
      superAdminActor,
    );
    const [row] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.id, result.item.identityId))
      .limit(1);
    assert.ok(row?.verificationTokenHash);
    assert.equal(
      row.verificationTokenHash,
      hashVerificationToken(
        result.verificationToken,
        result.item.identityId,
      ),
    );
    assert.notEqual(row.verificationTokenHash, result.verificationToken);
  });

  it("creates audit row without plaintext token or hash", async () => {
    await createPendingForUser(db, PROOF_USER, fixtureEmail("audit"));
    const result = await issueSelfVerificationTokenForAdminProof(
      db,
      superAdminActor,
    );
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, result.item.identityId),
          eq(
            schema.auditLogs.action,
            MAIL_AUDIT_ACTIONS.notificationIdentityVerificationTokenIssued,
          ),
        ),
      );
    assert.ok(audits.length >= 1);
    const latestAudit = audits.at(-1);
    assert.equal(latestAudit?.userId, PROOF_USER);
    const metadataJson = JSON.stringify(latestAudit?.metadata ?? {});
    assert.doesNotMatch(metadataJson, new RegExp(result.verificationToken));
    assert.doesNotMatch(metadataJson, /verificationTokenHash/);
    assert.doesNotMatch(metadataJson, /verificationToken/);
  });

  it("invalidates first token after regeneration and verifies newest token", async () => {
    await createPendingForUser(db, PROOF_USER, fixtureEmail("regen"));

    const firstNowMs = Date.now();
    const first = await issueSelfVerificationTokenForAdminProof(
      db,
      superAdminActor,
      { nowMs: firstNowMs },
    );
    const second = await issueSelfVerificationTokenForAdminProof(
      db,
      superAdminActor,
      { nowMs: firstNowMs + RESEND_COOLDOWN_ADVANCE_MS },
    );

    await assert.rejects(
      () =>
        verifyNotificationIdentity(db, permissionMgmtActor, {
          identityId: first.item.identityId,
          token: first.verificationToken,
        }),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 400);
        assert.match(error.message, /Invalid verification code/);
        return true;
      },
    );

    const verified = await verifyNotificationIdentity(db, permissionMgmtActor, {
      identityId: second.item.identityId,
      token: second.verificationToken,
    });
    assert.equal(verified.verificationStatus, "verified");
  });

  it("rejects token issue after identity is verified", async () => {
    const capture = createCapturingNotificationVerificationChallengeSink();
    await createPendingNotificationIdentity(db, permissionMgmtActor, {
      targetUserId: PROOF_USER,
      email: fixtureEmail("verified-block"),
      challengeSink: capture.sink,
    });
    const token = capture.latestToken();
    assert.ok(token);
    const [pending] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, PROOF_USER))
      .limit(1);
    await verifyNotificationIdentity(db, permissionMgmtActor, {
      identityId: pending!.id,
      token,
    });

    await assert.rejects(
      () => issueSelfVerificationTokenForAdminProof(db, superAdminActor),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 400);
        return true;
      },
    );
  });

  it("enforces max 3 issuance per rolling 24 hours", async () => {
    await createPendingForUser(db, PROOF_USER, fixtureEmail("rate-limit"));

    const baseNowMs = Date.parse("2026-08-26T13:00:00.000Z");
    for (let i = 0; i < VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_MAX; i += 1) {
      await issueSelfVerificationTokenForAdminProof(db, superAdminActor, {
        nowMs: baseNowMs + i * RESEND_COOLDOWN_ADVANCE_MS,
      });
    }

    await assert.rejects(
      () =>
        issueSelfVerificationTokenForAdminProof(db, superAdminActor, {
          nowMs:
            baseNowMs +
            VERIFICATION_TOKEN_ISSUE_RATE_LIMIT_MAX * RESEND_COOLDOWN_ADVANCE_MS,
        }),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 409);
        assert.match(error.message, /rate limit exceeded/);
        return true;
      },
    );
  });

  it("normal create and list responses expose no token or hash", async () => {
    const created = await createPendingNotificationIdentity(
      db,
      permissionMgmtActor,
      {
        targetUserId: PROOF_USER,
        email: fixtureEmail("no-secrets"),
      },
    );
    assert.doesNotThrow(() =>
      assertNotificationIdentityResponseHasNoSecrets({ item: created }),
    );

    const listed = await listNotificationIdentitiesForAdmin(
      db,
      permissionMgmtActor,
      PROOF_USER,
    );
    for (const item of listed) {
      assert.doesNotThrow(() =>
        assertNotificationIdentityResponseHasNoSecrets({ item }),
      );
      assert.equal(
        (item as Record<string, unknown>).verificationTokenHash,
        undefined,
      );
    }

    const safeView = toSafeNotificationIdentityAdminView({
      ...created,
      verificationTokenHash: "would-be-secret",
    } as never);
    assert.doesNotThrow(() =>
      assertNotificationIdentityResponseHasNoSecrets({ item: safeView }),
    );
  });
});

describe("admin verification token issue route static config", () => {
  it("self proof route is guarded for local test only", () => {
    const route = readFileSync(
      "src/app/api/mail/admin/notification-identities/self/issue-verification-token/route.ts",
      "utf8",
    );
    assert.match(route, /assertNotificationVerificationProofTokenApiAllowed/);
    assert.match(route, /issueSelfVerificationTokenForAdminProof/);
  });

  it("target-user raw token route is removed", () => {
    const route = readFileSync(
      "src/app/api/mail/access/[userId]/notification-identities/send-verification/route.ts",
      "utf8",
    );
    assert.match(route, /sendNotificationIdentityVerificationChallenge/);
    assert.doesNotMatch(route, /issueTargetVerificationTokenForAdminProof/);
    assert.doesNotMatch(route, /verificationToken/);
  });
});
