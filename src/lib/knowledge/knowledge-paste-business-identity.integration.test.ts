import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import {
  createKnowledgePasteSource,
  getKnowledgeSource,
} from "@/lib/knowledge/source-service";
import { organizeKnowledgeSource } from "@/lib/knowledge/ai-organizer-service";
import { CHASE_PRIVATE_CLIENT_FIXTURE_TEXT } from "@/lib/knowledge/knowledge-evidence-grounding";

const META = { ipAddress: null, userAgent: "knowledge-business-identity-test" };
const HSBC_FIXTURE = `香港汇丰银行账户

开户资料与最低资产说明。`;

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let staffUser: User;

const contributorContext = () => ({
  user: staffUser,
  sessionId: "business-identity-staff-session",
  role: "contributor" as const,
});

async function cleanup() {
  await db.delete(schema.knowledgeAiOrganizationRuns);
  await db.delete(schema.knowledgeSources);
  await db.delete(schema.auditLogs).where(like(schema.auditLogs.action, "knowledge_%"));
}

describe("knowledge paste business identity organizer integration", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    staffUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffA)).limit(1)
    )[0] as User;
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  beforeEach(async () => {
    await cleanup();
  });

  it("D/E: HSBC then Chase reorganize clears stale identity", async () => {
    const source = await createKnowledgePasteSource(
      contributorContext(),
      { rawText: HSBC_FIXTURE },
      META,
      db,
    );
    const hsbcOrganized = await organizeKnowledgeSource(
      contributorContext(),
      source.id,
      META,
      db,
    );
    assert.match(hsbcOrganized.organization?.proposedTitle ?? "", /汇丰/);
    assert.equal(
      hsbcOrganized.organization?.businessIdentity?.requestedProjectCode,
      "hk_bank_account",
    );

    await db
      .update(schema.knowledgeSources)
      .set({
        rawText: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.knowledgeSources.id, source.id));

    const chaseOrganized = await organizeKnowledgeSource(
      contributorContext(),
      source.id,
      META,
      db,
    );
    assert.match(chaseOrganized.organization?.proposedTitle ?? "", /Chase/i);
    assert.equal(
      chaseOrganized.organization?.businessIdentity?.requestedProjectCode,
      "us_bank_account",
    );
    assert.doesNotMatch(chaseOrganized.organization?.proposedTitle ?? "", /汇丰/);
  });

  it("E reverse: Chase then HSBC reorganize clears stale identity", async () => {
    const source = await createKnowledgePasteSource(
      contributorContext(),
      { rawText: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT },
      META,
      db,
    );
    await organizeKnowledgeSource(contributorContext(), source.id, META, db);

    await db
      .update(schema.knowledgeSources)
      .set({
        rawText: HSBC_FIXTURE,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.knowledgeSources.id, source.id));

    const hsbcOrganized = await organizeKnowledgeSource(
      contributorContext(),
      source.id,
      META,
      db,
    );
    assert.match(hsbcOrganized.organization?.proposedTitle ?? "", /汇丰/);
    assert.equal(
      hsbcOrganized.organization?.businessIdentity?.requestedProjectCode,
      "hk_bank_account",
    );
    assert.doesNotMatch(hsbcOrganized.organization?.proposedTitle ?? "", /Chase/i);

    const latest = await getKnowledgeSource(contributorContext(), source.id, db);
    assert.equal(latest.organization?.proposedTitle, hsbcOrganized.organization?.proposedTitle);
  });
});
