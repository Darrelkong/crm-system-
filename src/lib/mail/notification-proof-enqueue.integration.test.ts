import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
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
  createPendingNotificationIdentity,
  verifyNotificationIdentity,
} from "@/lib/mail/notification-identity-service";
import { createCapturingNotificationVerificationChallengeSink } from "@/lib/mail/notification-verification-challenge-sink";
import {
  enqueueNotificationProofForAdmin,
  NOTIFICATION_PROOF_RATE_LIMIT_MAX,
  NOTIFICATION_PROOF_SOURCE_ENTITY_ID_PREFIX,
} from "@/lib/mail/notification-proof-enqueue-service";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-phase2c12c3a-h3";
const PROOF_USER = SEED_IDS.staffA;

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailAdminPermission[],
  mailAccessEnabled = true,
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: "admin",
    mailAccessEnabled,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: FIXTURE },
  };
}

const superAdminActor = actor(PROOF_USER, ["super_admin"]);
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

async function createVerifiedIdentity(
  db: TestDb,
  userId: string,
  email: string,
): Promise<string> {
  const permissionActor = actor(SEED_IDS.admin, ["permission_mgmt"]);
  const capture = createCapturingNotificationVerificationChallengeSink();
  const pending = await createPendingNotificationIdentity(db, permissionActor, {
    targetUserId: userId,
    email,
    challengeSink: capture.sink,
  });
  const token = capture.latestToken();
  assert.ok(token);
  const verified = await verifyNotificationIdentity(db, permissionActor, {
    identityId: pending.id,
    token,
  });
  return verified.id;
}

async function cleanupProofFixtures(db: TestDb) {
  const outboxRows = await db
    .select({ id: schema.mailNotificationOutbox.id })
    .from(schema.mailNotificationOutbox)
    .where(
      and(
        eq(schema.mailNotificationOutbox.recipientUserId, PROOF_USER),
        eq(
          schema.mailNotificationOutbox.sourceEntityType,
          MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof,
        ),
      ),
    );

  for (const row of outboxRows) {
    await db
      .delete(schema.mailNotificationAttempts)
      .where(
        eq(schema.mailNotificationAttempts.notificationOutboxId, row.id),
      );
  }

  await db
    .delete(schema.mailNotificationOutbox)
    .where(
      and(
        eq(schema.mailNotificationOutbox.recipientUserId, PROOF_USER),
        eq(
          schema.mailNotificationOutbox.sourceEntityType,
          MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof,
        ),
      ),
    );

  await db
    .delete(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.userId, PROOF_USER),
        eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.notificationProofEnqueued),
      ),
    );

  await db
    .delete(schema.mailNotificationIdentities)
    .where(eq(schema.mailNotificationIdentities.userId, PROOF_USER));
}

describe("notification proof enqueue service", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await cleanupProofFixtures(db);
    await enableMailAccess(db, PROOF_USER);
    await createVerifiedIdentity(db, PROOF_USER, fixtureEmail("notify"));
  });

  after(async () => {
    await cleanupProofFixtures(db);
    dispose?.();
  });

  it("rejects actor without mail access", async () => {
    await assert.rejects(
      () => enqueueNotificationProofForAdmin(db, noMailAccessActor),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 403);
        return true;
      },
    );
  });

  it("rejects non-super-admin actor", async () => {
    await assert.rejects(
      () => enqueueNotificationProofForAdmin(db, deliveryHealthActor),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 403);
        assert.match(error.message, /Super admin authority required/);
        return true;
      },
    );
  });

  it("rejects missing verified notification identity", async () => {
    await db
      .delete(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, PROOF_USER));

    await assert.rejects(
      () => enqueueNotificationProofForAdmin(db, superAdminActor),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 400);
        assert.match(error.message, /Verified notification identity/);
        return true;
      },
    );

    await createVerifiedIdentity(db, PROOF_USER, fixtureEmail("restored"));
  });

  it("enqueues proof notification and writes audit", async () => {
    const result = await enqueueNotificationProofForAdmin(db, superAdminActor);
    assert.equal(result.created, true);
    assert.equal(result.status, "pending");
    assert.equal(result.notificationType, "new_incoming");
    assert.equal(
      result.sourceEntityType,
      MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof,
    );
    assert.match(result.sourceEntityId, /^proof-2c12c3a-h3-/);
    assert.equal(result.recipientUserId, PROOF_USER);

    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.id, result.outboxId))
      .limit(1);
    assert.ok(outbox);
    assert.equal(outbox.status, "pending");

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, result.outboxId),
          eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.notificationProofEnqueued),
        ),
      );
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.userId, PROOF_USER);

    await db
      .update(schema.mailNotificationOutbox)
      .set({
        status: "sent",
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.mailNotificationOutbox.id, result.outboxId));
  });

  it("rejects duplicate pending/processing proof for same actor", async () => {
    const first = await enqueueNotificationProofForAdmin(db, superAdminActor);
    assert.equal(first.created, true);

    await assert.rejects(
      () => enqueueNotificationProofForAdmin(db, superAdminActor),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 409);
        assert.match(error.message, /active notification proof outbox/);
        return true;
      },
    );

    const completedAt = new Date().toISOString();
    await db
      .update(schema.mailNotificationOutbox)
      .set({
        status: "sent",
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(schema.mailNotificationOutbox.id, first.outboxId));
  });

  it("enforces 24h proof enqueue rate limit", async () => {
    await cleanupProofFixtures(db);
    await createVerifiedIdentity(db, PROOF_USER, fixtureEmail("rate-limit"));

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const [identity] = await db
      .select({ id: schema.mailNotificationIdentities.id })
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, PROOF_USER))
      .limit(1);
    assert.ok(identity);

    for (let i = 0; i < NOTIFICATION_PROOF_RATE_LIMIT_MAX; i += 1) {
      await db.insert(schema.mailNotificationOutbox).values({
        id: crypto.randomUUID(),
        notificationType: "new_incoming",
        recipientUserId: PROOF_USER,
        notificationIdentityId: identity.id,
        sourceEntityType:
          MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof,
        sourceEntityId: `${NOTIFICATION_PROOF_SOURCE_ENTITY_ID_PREFIX}seed-${i}`,
        status: "sent",
        processingVersion: 1,
        enqueuedAt: now,
        completedAt: now,
        updatedAt: now,
      });
    }

    await assert.rejects(
      () => enqueueNotificationProofForAdmin(db, superAdminActor, { nowMs }),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 409);
        assert.match(error.message, /rate limit exceeded/);
        return true;
      },
    );
  });
});

describe("notification proof enqueue route static config", () => {
  it("route module exports POST handler and uses mail actor wiring", () => {
    const route = readFileSync(
      "src/app/api/mail/admin/notification-proof/enqueue/route.ts",
      "utf8",
    );
    assert.match(route, /export async function POST/);
    assert.match(route, /requireMailActor/);
    assert.match(route, /enqueueNotificationProofForAdmin/);
    assert.doesNotMatch(route, /recipientUserId/);
    assert.doesNotMatch(route, /targetEmail/);
  });
});
