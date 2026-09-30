import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import {
  listKnowledgeSegmentCandidates,
} from "@/lib/knowledge/knowledge-segment-candidate-service";
import {
  organizeKnowledgeSegmentCandidate,
} from "@/lib/knowledge/knowledge-segment-candidate-organizer-service";
import {
  latestCandidateOrganization,
  latestSourceLevelOrganization,
} from "@/lib/knowledge/knowledge-organization-run-queries";
import {
  processKnowledgeSourceAnalysisRun,
  startKnowledgeSourceAnalysis,
  updateKnowledgeSourceSegmentStatus,
} from "@/lib/knowledge/smart-ingest-analysis-service";
import { createKnowledgePasteSource } from "@/lib/knowledge/source-service";
import { assertSourceLevelOrganizeAllowed } from "@/lib/knowledge/smart-ingest-source-scope";
import { loadSmartIngestSourceScope } from "@/lib/knowledge/smart-ingest-source-scope";
import { buildCandidateOrganizerDraft } from "@/lib/knowledge/knowledge-segment-candidate-organizer-draft";

const META = { ipAddress: "127.0.0.1", userAgent: "candidate-organizer-test" };

const THREE_TOPIC = `汇丰香港私人银行
最低资产要求50万港币
办理周期4–6周

---

中国银行香港私人银行
开户需身份证、护照及香港地址证明
最低资产要求100万港币

---

Chase Private Client
开户需身份证正反面、有效护照及60天内美国地址银行对账单
激活款15W美金
ACH日额度10万美元
Zelle每日15,000美元`;

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let staffUser: User;

const contributorContext = () => ({
  sessionId: "candidate-organizer-session",
  user: staffUser,
  role: "contributor" as const,
});

async function cleanup(): Promise<void> {
  await db.delete(schema.knowledgeAiOrganizationRuns);
  await db.delete(schema.knowledgeSourceSegmentCandidates);
  await db.delete(schema.knowledgeSourceSegments);
  await db.delete(schema.knowledgeSourceAnalysisRuns);
  await db.delete(schema.knowledgeSources);
}

async function confirmAllThree(text: string) {
  const source = await createKnowledgePasteSource(
    contributorContext(),
    { rawText: text },
    META,
    db,
  );
  const started = await startKnowledgeSourceAnalysis(
    contributorContext(),
    source.id,
    META,
    db,
  );
  await processKnowledgeSourceAnalysisRun(started.runId, db);
  const segments = await db
    .select()
    .from(schema.knowledgeSourceSegments)
    .where(eq(schema.knowledgeSourceSegments.analysisRunId, started.runId))
    .orderBy(schema.knowledgeSourceSegments.segmentIndex);
  for (const segment of segments) {
    await updateKnowledgeSourceSegmentStatus(
      contributorContext(),
      source.id,
      segment.id,
      "confirmed",
      META,
      db,
    );
  }
  const candidates = await listKnowledgeSegmentCandidates(
    contributorContext(),
    source.id,
    db,
  );
  return { source, candidates, segments };
}

describe("knowledge segment candidate organizer (2E-3/4)", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    staffUser = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, SEED_IDS.staffA))
        .limit(1)
    )[0] as User;
  });

  afterEach(async () => {
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("A–C: per-segment business identity for HSBC / BOCHK / Chase", async () => {
    const { candidates } = await confirmAllThree(THREE_TOPIC);
    assert.equal(candidates.length, 3);
    assert.equal(candidates[0]?.requestedProjectCode, "hk_bank_account");
    assert.equal(candidates[1]?.requestedProjectCode, "hk_bank_account");
    assert.equal(candidates[2]?.requestedProjectCode, "us_bank_account");
  });

  it("D/E: candidate organizer uses segment evidence only and sets candidate_id", async () => {
    const { source, candidates, segments } = await confirmAllThree(THREE_TOPIC);
    const hsbc = candidates[0]!;
    await organizeKnowledgeSegmentCandidate(
      contributorContext(),
      source.id,
      hsbc.id,
      META,
      db,
    );
    const run = await latestCandidateOrganization(hsbc.id, db);
    assert.ok(run);
    assert.equal(run?.candidateId, hsbc.id);
    assert.match(run?.proposedBody ?? "", /汇丰/);
    assert.doesNotMatch(run?.proposedBody ?? "", /Chase Private Client/);
    assert.equal(segments[0]!.evidenceText.includes("中国银行"), false);
    const sourceRun = await latestSourceLevelOrganization(source.id, db);
    assert.equal(sourceRun?.candidateId ?? null, null);
  });

  it("E/F: independent candidate runs do not block each other", async () => {
    const { source, candidates } = await confirmAllThree(THREE_TOPIC);
    await organizeKnowledgeSegmentCandidate(
      contributorContext(),
      source.id,
      candidates[0]!.id,
      META,
      db,
    );
    await organizeKnowledgeSegmentCandidate(
      contributorContext(),
      source.id,
      candidates[2]!.id,
      META,
      db,
    );
    const run0 = await latestCandidateOrganization(candidates[0]!.id, db);
    const run2 = await latestCandidateOrganization(candidates[2]!.id, db);
    assert.equal(run0?.status, "completed");
    assert.equal(run2?.status, "completed");
  });

  it("H: multi-topic source-level organizer remains blocked", async () => {
    const { source } = await confirmAllThree(THREE_TOPIC);
    const scope = await loadSmartIngestSourceScope(
      source.id,
      "ready_for_review",
      db,
    );
    assert.throws(() => assertSourceLevelOrganizeAllowed(scope));
  });

  it("J: failed candidate does not reset successful candidate", async () => {
    const { source, candidates } = await confirmAllThree(THREE_TOPIC);
    await organizeKnowledgeSegmentCandidate(
      contributorContext(),
      source.id,
      candidates[0]!.id,
      META,
      db,
    );
    await db
      .update(schema.knowledgeSourceSegments)
      .set({ evidenceText: "ab" })
      .where(eq(schema.knowledgeSourceSegments.id, candidates[1]!.segmentId));
    await assert.rejects(
      organizeKnowledgeSegmentCandidate(
        contributorContext(),
        source.id,
        candidates[1]!.id,
        META,
        db,
      ),
    );
    const run0 = await latestCandidateOrganization(candidates[0]!.id, db);
    assert.equal(run0?.status, "completed");
  });

  it("after organize AI category draft only when organization completed", async () => {
    const { source, candidates } = await confirmAllThree(THREE_TOPIC);
    const before = await buildCandidateOrganizerDraft(
      contributorContext(),
      source.id,
      candidates[2]!,
      {},
      db,
    );
    assert.equal(before.title, "");
    await organizeKnowledgeSegmentCandidate(
      contributorContext(),
      source.id,
      candidates[2]!.id,
      META,
      db,
    );
    const after = await buildCandidateOrganizerDraft(
      contributorContext(),
      source.id,
      (
        await listKnowledgeSegmentCandidates(
          contributorContext(),
          source.id,
          db,
        )
      ).find((row) => row.id === candidates[2]!.id)!,
      {},
      db,
    );
    assert.ok(after.title.length > 0);
    assert.ok(after.body.includes("Chase") || after.body.includes("Zelle"));
    assert.doesNotMatch(after.body, /汇丰香港私人银行/);
  });
});
