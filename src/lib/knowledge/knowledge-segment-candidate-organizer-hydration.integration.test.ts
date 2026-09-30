import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import { listKnowledgeSegmentCandidates } from "@/lib/knowledge/knowledge-segment-candidate-service";
import { organizeKnowledgeSegmentCandidate } from "@/lib/knowledge/knowledge-segment-candidate-organizer-service";
import {
  buildCandidateOrganizerDraftPayload,
  buildCandidateOrganizerDraft,
} from "@/lib/knowledge/knowledge-segment-candidate-organizer-draft";
import { isUsableCandidateOrganizerDraft } from "@/lib/knowledge/knowledge-candidate-organizer-draft-usability";
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

const META = { ipAddress: "127.0.0.1", userAgent: "candidate-hydration-test" };

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
Zelle每日15,000美元`;

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let staffUser: User;

const contributorContext = () => ({
  sessionId: "candidate-hydration-session",
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
  return { source, candidates };
}

describe("knowledge segment candidate organizer hydration hotfix", () => {
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

  it("A: completed run stores proposed fields and draft hydrates title/summary/body", async () => {
    const { source, candidates } = await confirmAllThree(THREE_TOPIC);
    const hsbc = candidates[0]!;
    await organizeKnowledgeSegmentCandidate(
      contributorContext(),
      source.id,
      hsbc.id,
      META,
      db,
    );
    const run = await latestCandidateOrganization(hsbc.id, db);
    assert.equal(run?.status, "completed");
    assert.ok(run?.proposedTitle?.trim());
    assert.ok(run?.proposedBody?.trim());
    const payload = await buildCandidateOrganizerDraftPayload(
      contributorContext(),
      source.id,
      (
        await listKnowledgeSegmentCandidates(
          contributorContext(),
          source.id,
          db,
        )
      ).find((row) => row.id === hsbc.id)!,
      {},
      db,
    );
    assert.equal(isUsableCandidateOrganizerDraft(payload.draft), true);
    assert.equal(payload.organizationRunId, run?.id);
  });

  it("G: latest candidate organization resolves by candidateId not sourceId", async () => {
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
      candidates[1]!.id,
      META,
      db,
    );
    const run0 = await latestCandidateOrganization(candidates[0]!.id, db);
    const run1 = await latestCandidateOrganization(candidates[1]!.id, db);
    assert.notEqual(run0?.id, run1?.id);
    const sourceRun = await latestSourceLevelOrganization(source.id, db);
    assert.equal(sourceRun, null);
    const draft0 = await buildCandidateOrganizerDraft(
      contributorContext(),
      source.id,
      (
        await listKnowledgeSegmentCandidates(
          contributorContext(),
          source.id,
          db,
        )
      ).find((row) => row.id === candidates[0]!.id)!,
      {},
      db,
    );
    const draft1 = await buildCandidateOrganizerDraft(
      contributorContext(),
      source.id,
      (
        await listKnowledgeSegmentCandidates(
          contributorContext(),
          source.id,
          db,
        )
      ).find((row) => row.id === candidates[1]!.id)!,
      {},
      db,
    );
    assert.match(draft0.body, /汇丰|50万/);
    assert.doesNotMatch(draft0.body, /中国银行香港/);
    assert.match(draft1.body, /中国银行|100万/);
    assert.doesNotMatch(draft1.body, /Chase Private Client/);
  });

  it("D/E: candidate drafts remain isolated across three organizes", async () => {
    const { source, candidates } = await confirmAllThree(THREE_TOPIC);
    for (const candidate of candidates) {
      await organizeKnowledgeSegmentCandidate(
        contributorContext(),
        source.id,
        candidate.id,
        META,
        db,
      );
    }
    const refreshed = await listKnowledgeSegmentCandidates(
      contributorContext(),
      source.id,
      db,
    );
    const drafts = await Promise.all(
      refreshed.map((row) =>
        buildCandidateOrganizerDraft(
          contributorContext(),
          source.id,
          row,
          {},
          db,
        ),
      ),
    );
    assert.match(drafts[0]!.body, /汇丰/);
    assert.match(drafts[1]!.body, /中国银行/);
    assert.match(drafts[2]!.body, /Chase|Zelle/);
    assert.doesNotMatch(drafts[0]!.body, /Zelle/);
    assert.doesNotMatch(drafts[2]!.body, /100万港币/);
  });
});
