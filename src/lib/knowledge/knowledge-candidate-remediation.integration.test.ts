import { createKnowledgeArticle } from "@/lib/knowledge/core-service";
import { submitKnowledgeReview } from "@/lib/knowledge/review-service";
import { handleCandidatePatch } from "@/lib/knowledge/knowledge-candidate-patch";
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase, type Database } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { REQUESTED_PROJECT_ITEMS } from "@/lib/constants/requested-projects";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { updateCandidateManualClassification, applyCandidateBusinessFromEvidence } from "@/lib/knowledge/knowledge-segment-candidate-classification";
import { convertKnowledgeSegmentCandidateToDraft } from "@/lib/knowledge/knowledge-segment-candidate-convert-service";
import { listKnowledgeSegmentCandidates, materializeKnowledgeSegmentCandidatesForSource } from "@/lib/knowledge/knowledge-segment-candidate-service";
import { organizeKnowledgeSegmentCandidate } from "@/lib/knowledge/knowledge-segment-candidate-organizer-service";
import { latestCandidateOrganization } from "@/lib/knowledge/knowledge-organization-run-queries";
import { compareKnowledgeSegmentCandidate, compareKnowledgeSource } from "@/lib/knowledge/comparison-service";
import { createKnowledgePasteSource, archiveKnowledgeSource } from "@/lib/knowledge/source-service";
import { organizeKnowledgeSource } from "@/lib/knowledge/ai-organizer-service";
import { startKnowledgeSourceAnalysis, processKnowledgeSourceAnalysisRun, updateKnowledgeSourceSegmentStatus } from "@/lib/knowledge/smart-ingest-analysis-service";
import { buildCandidateOrganizerDraft } from "@/lib/knowledge/knowledge-segment-candidate-organizer-draft";
import { syncCandidateCategoryFromOrganizerDraft } from "@/lib/knowledge/knowledge-segment-candidate-draft-sync";
import { executeKnowledgeOrganizationOnEvidence } from "@/lib/knowledge/knowledge-organization-execution";
import { knowledgeArticleDetailPath, resolveCandidateDraftArticleId } from "@/lib/knowledge/knowledge-article-paths";
import type { KnowledgeCategoryAiSuggestionResult } from "@/lib/knowledge/knowledge-category-ai-suggestion-schema";

const META = { ipAddress: "127.0.0.1", userAgent: "1b-a-local-remediation" };
const TEXT = "汇丰香港私人银行\n最低资产要求50万港币\n办理周期4–6周";
const THREE = `${TEXT}\n\n---\n\n中国银行香港私人银行\n开户需身份证、护照及香港地址证明\n最低资产要求100万港币\n\n---\n\nChase Private Client\n开户需有效护照及60天内美国地址银行对账单\n激活款15W美金\nZelle每日15,000美元`;
const DRAFT = { title: "汇丰香港账户", summary: "汇丰香港私人银行开户要求摘要。", body: "汇丰香港私人银行最低资产要求50万港币，办理周期4–6周。" };
let db: Database;
let dispose: (() => Promise<void>) | undefined;
let staff: User;
let other: User;
let admin: User;
const actor = (): KnowledgeSessionContext => ({ user: staff, sessionId: "local-candidate", role: "contributor" });
const adminActor = (): KnowledgeSessionContext => ({ user: admin, sessionId: "local-admin", role: "knowledge_admin" });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function barrier(count: number) {
  const ready = deferred();
  let arrived = 0;
  return async () => { if (++arrived === count) ready.resolve(); await ready.promise; };
}
function hasSql(queries: readonly unknown[], fragment: string) {
  return queries.some((query) => (query as { toSQL(): { sql: string } }).toSQL().sql.includes(fragment));
}
function batchHook(beforeBatch: (queries: readonly unknown[]) => Promise<void>, afterBatch?: () => void): Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "batch") return async (queries: Parameters<Database["batch"]>[0]) => {
        await beforeBatch(queries);
        const result = await target.batch(queries);
        afterBatch?.();
        return result;
      };
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
async function cleanup() {
  await db.run(sql`DROP TRIGGER IF EXISTS candidate_remediation_fault`);
  await db.delete(schema.knowledgeAiComparisonRuns);
  await db.delete(schema.knowledgeAiOrganizationRuns);
  await db.update(schema.knowledgeSourceSegmentCandidates).set({ draftArticleId: null, convertedAt: null });
  await db.delete(schema.knowledgeArticlePublications);
  await db.delete(schema.knowledgeReviewRequests);
  await db.delete(schema.knowledgeArticleVersions);
  await db.delete(schema.knowledgeArticles);
  await db.delete(schema.knowledgeSourceSegmentCandidates);
  await db.delete(schema.knowledgeSourceSegments);
  await db.delete(schema.knowledgeSourceAnalysisRuns);
  await db.delete(schema.knowledgeSources);
  await db.delete(schema.knowledgeBusinessCategoryMappings);
  await db.delete(schema.knowledgeCategories);
  await db.delete(schema.auditLogs);
}
async function category(name = "本机分类") {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(schema.knowledgeCategories).values({ id, name, slug: id, isActive: true, createdAt: now, updatedAt: now });
  return id;
}
async function fixture(text = TEXT) {
  const source = await createKnowledgePasteSource(actor(), { rawText: text }, META, db);
  const run = await startKnowledgeSourceAnalysis(actor(), source.id, META, db);
  await processKnowledgeSourceAnalysisRun(run.runId, db);
  const segments = await db.select().from(schema.knowledgeSourceSegments)
    .where(eq(schema.knowledgeSourceSegments.analysisRunId, run.runId)).orderBy(schema.knowledgeSourceSegments.segmentIndex);
  for (const segment of segments) await updateKnowledgeSourceSegmentStatus(actor(), source.id, segment.id, "confirmed", META, db);
  const candidates = await listKnowledgeSegmentCandidates(actor(), source.id, db);
  const categoryId = await category();
  return { source, segments, candidates, categoryId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function prepare(f: Fixture, index = 0) {
  const candidate = f.candidates[index]!;
  await updateCandidateManualClassification(actor(), f.source.id, candidate.id, { knowledgeCategoryId: f.categoryId }, db);
  await organizeKnowledgeSegmentCandidate(actor(), f.source.id, candidate.id, META, db);
  const organization = (await latestCandidateOrganization(candidate.id, db))!;
  await compareKnowledgeSegmentCandidate(actor(), f.source.id, candidate.id,
    { ...DRAFT, organizationRunId: organization.id }, META, db, { candidates: [] });
  return { candidate, organization };
}
function convert(f: Fixture, database = db, index = 0, context = actor()) {
  return convertKnowledgeSegmentCandidateToDraft(context, f.source.id, f.candidates[index]!.id,
    { ...DRAFT, categoryId: f.categoryId }, META, database);
}
async function candidateRow(id: string) {
  return (await db.select().from(schema.knowledgeSourceSegmentCandidates)
    .where(eq(schema.knowledgeSourceSegmentCandidates.id, id)).limit(1))[0]!;
}
async function detail(f: Fixture) {
  return (await listKnowledgeSegmentCandidates(actor(), f.source.id, db))[0]!;
}
async function counts() {
  return {
    articles: (await db.select().from(schema.knowledgeArticles)).length,
    versions: (await db.select().from(schema.knowledgeArticleVersions)).length,
    audits: (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "knowledge_article_create"))).length,
    links: (await db.select().from(schema.knowledgeSourceSegmentCandidates)
      .where(sql`draft_article_id IS NOT NULL AND converted_at IS NOT NULL`)).length,
  };
}
async function denied(operation: () => Promise<unknown>, status: number | number[]) {
  await assert.rejects(operation, (error: unknown) => error instanceof KnowledgeServiceError &&
    (Array.isArray(status) ? status : [status]).includes(error.httpStatus));
}
const zero = { articles: 0, versions: 0, audits: 0, links: 0 };
const one = { articles: 1, versions: 1, audits: 1, links: 1 };

async function automaticDraft(f: Fixture, result: KnowledgeCategoryAiSuggestionResult, wait?: () => Promise<void>) {
  const snapshot = await detail(f);
  const run = (await latestCandidateOrganization(snapshot.id, db))!;
  const draft = await buildCandidateOrganizerDraft(actor(), f.source.id, snapshot, {}, db, {
    suggestCategory: async () => { await wait?.(); return result; },
  });
  await syncCandidateCategoryFromOrganizerDraft(snapshot, draft, db, run.id);
  return draft;
}
function high(id: string): KnowledgeCategoryAiSuggestionResult {
  return { status: "suggested", categoryId: id, categoryName: "AI分类", confidenceBand: "high", resolutionSource: "ai_suggestion", requiresConfirmation: false };
}

describe("1B-A candidate release blocker remediation on isolated D1", () => {
  before(async () => {
    assert.equal(process.env.CRM_ALLOW_TEST_DB_BIND, "1");
    assert.match(process.env.CRM_TEST_D1_HTTP_URL ?? "", /^http:\/\/127\.0\.0\.1:\d+\//);
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    dispose = proxy.dispose;
    bindTestDatabase(db);
    const users = await db.select().from(schema.users);
    staff = users.find((u) => u.id === SEED_IDS.staffA)!;
    other = users.find((u) => u.id === SEED_IDS.staffB)!;
    admin = users.find((u) => u.id === SEED_IDS.admin)!;
    assert.ok(staff && other && admin);
    await cleanup();
  });
  afterEach(cleanup);
  after(async () => { bindTestDatabase(null); await dispose?.(); });

  async function patch(f: Fixture, body: unknown, context = actor()) {
    return handleCandidatePatch(new Request("http://localhost/candidate", {
      method: "PATCH", body: JSON.stringify(body),
    }), Promise.resolve({ id: f.source.id, candidateId: f.candidates[0]!.id }), async () => context, () => db);
  }

  it("1B-A3 selecting then clearing category via PATCH keeps human override active", async () => {
    const f = await fixture();
    assert.equal((await patch(f, { knowledgeCategoryId: f.categoryId })).status, 200);
    const selected = await candidateRow(f.candidates[0]!.id);
    assert.equal(selected.knowledgeCategoryId, f.categoryId);
    assert.equal(selected.manualCategoryOverride, true);
    assert.equal((await patch(f, { knowledgeCategoryId: null })).status, 200);
    const cleared = await candidateRow(selected.id);
    assert.equal(cleared.knowledgeCategoryId, null);
    assert.equal(cleared.manualCategoryOverride, true);
    assert.equal(cleared.categoryResolutionSource, "manual");
    assert.notEqual(cleared.updatedAt, selected.updatedAt);
  });

  it("1B-A3 delayed AI from an older revision makes zero candidate mutation after human clear", async () => {
    const f = await fixture();
    await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
    const entered = deferred(); const release = deferred();
    const pending = automaticDraft(f, high(f.categoryId), async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    assert.equal((await patch(f, { knowledgeCategoryId: null })).status, 200);
    const cleared = await candidateRow(f.candidates[0]!.id);
    release.resolve(); await pending;
    assert.deepEqual(await candidateRow(cleared.id), cleared);
  });

  it("1B-A3 delayed explicit mapping and evidence snapshots cannot refill human blank", async () => {
    const f = await fixture(); const code = REQUESTED_PROJECT_ITEMS[0]!.code; const now = new Date().toISOString();
    await patch(f, { requestedProjectCode: code });
    await db.insert(schema.knowledgeBusinessCategoryMappings).values({ id: crypto.randomUUID(), requestedProjectCode: code,
      knowledgeCategoryId: f.categoryId, isActive: true, createdAt: now, updatedAt: now });
    await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
    const snapshot = await detail(f); const run = (await latestCandidateOrganization(snapshot.id, db))!;
    const mapped = await buildCandidateOrganizerDraft(actor(), f.source.id, snapshot, {}, db);
    assert.equal(mapped.categoryId, f.categoryId);
    const evidenceSnapshot = await candidateRow(snapshot.id);
    await patch(f, { knowledgeCategoryId: null });
    const cleared = await candidateRow(snapshot.id);
    await syncCandidateCategoryFromOrganizerDraft(snapshot, mapped, db, run.id);
    assert.deepEqual(await candidateRow(snapshot.id), cleared);
    await applyCandidateBusinessFromEvidence(evidenceSnapshot, TEXT, db);
    assert.deepEqual(await candidateRow(snapshot.id), cleared);
  });

  it("1B-A3 fresh organizer hydration and business changes preserve intentionally blank category", async () => {
    const f = await fixture(); await patch(f, { knowledgeCategoryId: null });
    const code = REQUESTED_PROJECT_ITEMS[0]!.code; const now = new Date().toISOString();
    await db.insert(schema.knowledgeBusinessCategoryMappings).values({ id: crypto.randomUUID(), requestedProjectCode: code,
      knowledgeCategoryId: f.categoryId, isActive: true, createdAt: now, updatedAt: now });
    await patch(f, { requestedProjectCode: code });
    await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
    const snapshot = await detail(f); let aiCalled = false;
    // An old caller's false flag is not the explicit PATCH reset action.
    const draft = await buildCandidateOrganizerDraft(actor(), f.source.id, snapshot, { manualCategoryOverride: false }, db, {
      suggestCategory: async () => { aiCalled = true; return high(f.categoryId); },
    });
    assert.equal(aiCalled, false); assert.equal(draft.categoryId, "");
    assert.equal(draft.categoryResolutionSource, "manual");
    const before = await candidateRow(snapshot.id);
    await syncCandidateCategoryFromOrganizerDraft(snapshot, draft, db, (await latestCandidateOrganization(snapshot.id, db))!.id);
    assert.deepEqual(await candidateRow(snapshot.id), before);
    assert.equal(before.manualCategoryOverride, true); assert.equal(before.knowledgeCategoryId, null);
  });

  it("1B-A3 explicit PATCH reset re-enables the current active mapping", async () => {
    const f = await fixture(); const code = REQUESTED_PROJECT_ITEMS[0]!.code; const now = new Date().toISOString();
    await patch(f, { requestedProjectCode: code, knowledgeCategoryId: null });
    const before = await candidateRow(f.candidates[0]!.id);
    assert.equal(before.manualCategoryOverride, true);
    await db.insert(schema.knowledgeBusinessCategoryMappings).values({ id: crypto.randomUUID(), requestedProjectCode: code,
      knowledgeCategoryId: f.categoryId, isActive: true, createdAt: now, updatedAt: now });
    assert.equal((await patch(f, { restoreAutomaticClassification: true })).status, 200);
    const restored = await candidateRow(before.id);
    assert.equal(restored.manualCategoryOverride, false);
    assert.equal(restored.knowledgeCategoryId, f.categoryId);
    assert.equal(restored.categoryResolutionSource, "explicit_mapping");
    assert.notEqual(restored.updatedAt, before.updatedAt);
  });

  for (const mode of ["high", "medium", "low", "error"] as const) {
    it(`1B-A3 reset without mapping retains existing ${mode} AI/fallback policy`, async () => {
      const f = await fixture(); await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
      await patch(f, { knowledgeCategoryId: null });
      assert.equal((await patch(f, { restoreAutomaticClassification: true })).status, 200);
      assert.equal((await candidateRow(f.candidates[0]!.id)).manualCategoryOverride, false);
      assert.equal((await candidateRow(f.candidates[0]!.id)).knowledgeCategoryId, null);
      const suggestion: KnowledgeCategoryAiSuggestionResult = mode === "high" ? high(f.categoryId)
        : mode === "medium" ? { ...high(f.categoryId), confidenceBand: "medium", requiresConfirmation: true }
        : { status: mode === "low" ? "insufficient_confidence" : "error",
          resolutionSource: null, requiresConfirmation: false };
      const draft = await automaticDraft(f, suggestion);
      const after = await candidateRow(f.candidates[0]!.id);
      assert.equal(after.manualCategoryOverride, false);
      assert.equal(after.knowledgeCategoryId, mode === "high" ? f.categoryId : null);
      if (mode === "medium") assert.equal(draft.categoryAiRequiresConfirmation, true);
      if (mode === "low" || mode === "error") assert.equal(draft.categorySelectionRequired, true);
    });
  }

  it("1B-A3 conflicting reset and manual category payload is rejected without partial writes", async () => {
    const f = await fixture(); await patch(f, { knowledgeCategoryId: null });
    const before = await candidateRow(f.candidates[0]!.id);
    assert.equal((await patch(f, { restoreAutomaticClassification: true, knowledgeCategoryId: f.categoryId })).status, 400);
    assert.deepEqual(await candidateRow(before.id), before);
  });

  it("1B-A3 unauthorized reset cannot clear the human override", async () => {
    const f = await fixture(); await patch(f, { knowledgeCategoryId: null });
    const before = await candidateRow(f.candidates[0]!.id);
    assert.equal((await patch(f, { restoreAutomaticClassification: true }, { ...actor(), role: "viewer" })).status, 403);
    assert.deepEqual(await candidateRow(before.id), before);
  });

  for (const state of ["proposed", "failed-source"] as const) {
    it(`1B-A3 PATCH adapter rejects ${state} with zero candidate business-data mutation`, async () => {
      const f = await fixture();
      if (state === "proposed") await updateKnowledgeSourceSegmentStatus(actor(), f.source.id, f.segments[0]!.id, "proposed", META, db);
      else await db.update(schema.knowledgeSources).set({ status: "failed" }).where(eq(schema.knowledgeSources.id, f.source.id));
      const before = await candidateRow(f.candidates[0]!.id);
      assert.equal((await patch(f, { requestedProjectCode: "other", knowledgeCategoryId: f.categoryId })).status, 409);
      assert.deepEqual(await candidateRow(before.id), before);
    });
  }

  it("PATCH HTTP adapter enforces authorization and malformed JSON without candidate writes", async () => {
    const f = await fixture();
    const before = await candidateRow(f.candidates[0]!.id);
    const params = Promise.resolve({ id: f.source.id, candidateId: before.id });
    for (const role of ["viewer", "reviewer"] as const) {
      const response = await handleCandidatePatch(new Request("http://localhost/candidate", {
        method: "PATCH", body: JSON.stringify({ knowledgeCategoryId: f.categoryId }),
      }), params, async () => ({ ...actor(), role }), () => db);
      assert.equal(response.status, 403);
      assert.deepEqual(await candidateRow(before.id), before);
    }
    const malformed = await handleCandidatePatch(new Request("http://localhost/candidate", {
      method: "PATCH", body: "{",
    }), params, async () => actor(), () => db);
    assert.equal(malformed.status, 400);
    for (const status of [401, 423]) {
      let dbAccess = false;
      const response = await handleCandidatePatch(new Request("http://localhost/candidate", {
        method: "PATCH", body: JSON.stringify({ knowledgeCategoryId: f.categoryId }),
      }), params, async () => { throw new KnowledgeServiceError("LOCAL_AUTH_DENIED", "local denial", status); },
      () => { dbAccess = true; return db; });
      assert.equal(response.status, status); assert.equal(dbAccess, false);
    }
    assert.deepEqual(await candidateRow(before.id), before);
  });
  it("PATCH HTTP success returns the committed classification snapshot", async () => {
    const f = await fixture();
    const response = await handleCandidatePatch(new Request("http://localhost/candidate", {
      method: "PATCH", body: JSON.stringify({ knowledgeCategoryId: f.categoryId, requestedProjectCode: "other" }),
    }), Promise.resolve({ id: f.source.id, candidateId: f.candidates[0]!.id }), async () => actor(), () => db);
    assert.equal(response.status, 200);
    const body = await response.json() as { candidate: { knowledgeCategoryId: string; requestedProjectCode: string; segmentStatus: string } };
    assert.equal(body.candidate.knowledgeCategoryId, f.categoryId);
    assert.equal(body.candidate.requestedProjectCode, "other");
    assert.equal(body.candidate.segmentStatus, "confirmed");
  });

  for (const role of ["viewer", "reviewer"] as const) {
    it(`PATCH service rejects ${role} with zero candidate writes`, async () => {
      const f = await fixture();
      const before = await candidateRow(f.candidates[0]!.id);
      await denied(() => updateCandidateManualClassification({ ...actor(), role }, f.source.id, before.id,
        { knowledgeCategoryId: f.categoryId }, db), 403);
      assert.deepEqual(await candidateRow(before.id), before);
    });
  }
  it("PATCH service rejects non-owner contributor with zero writes", async () => {
    const f = await fixture(); const before = await candidateRow(f.candidates[0]!.id);
    await denied(() => updateCandidateManualClassification({ ...actor(), user: other }, f.source.id, before.id,
      { requestedProjectCode: "other" }, db), 403);
    assert.deepEqual(await candidateRow(before.id), before);
  });
  it("PATCH service rejects a valid candidate under a different owned source", async () => {
    const f = await fixture(); const before = await candidateRow(f.candidates[0]!.id);
    const source2 = await createKnowledgePasteSource(actor(), { rawText: TEXT + "\n其他来源" }, META, db);
    await denied(() => updateCandidateManualClassification(actor(), source2.id, before.id,
      { knowledgeCategoryId: f.categoryId }, db), 404);
    assert.deepEqual(await candidateRow(before.id), before);
  });
  for (const state of ["superseded", "archived", "rejected", "old-analysis"] as const) {
    it(`PATCH ${state} candidate is denied with zero writes`, async () => {
      const f = await fixture(); const id = f.candidates[0]!.id;
      if (state === "superseded") await db.update(schema.knowledgeSourceSegmentCandidates).set({ status: "superseded" }).where(eq(schema.knowledgeSourceSegmentCandidates.id, id));
      if (state === "archived") await db.update(schema.knowledgeSources).set({ archivedAt: new Date().toISOString() }).where(eq(schema.knowledgeSources.id, f.source.id));
      if (state === "rejected") await updateKnowledgeSourceSegmentStatus(actor(), f.source.id, f.segments[0]!.id, "rejected", META, db);
      if (state === "old-analysis") await startKnowledgeSourceAnalysis(actor(), f.source.id, META, db);
      const before = await candidateRow(id);
      await denied(() => updateCandidateManualClassification(actor(), f.source.id, id, { knowledgeCategoryId: f.categoryId }, db), 409);
      assert.deepEqual(await candidateRow(id), before);
    });
  }
  for (const bad of [null, [], {}, { unexpected: 1 }, { requestedProjectCode: "invalid" },
    { requestedProjectCode: "other", knowledgeCategoryId: "invalid" }, { knowledgeCategoryId: 9 }]) {
    it(`PATCH malformed ${JSON.stringify(bad)} leaves all fields unchanged`, async () => {
      const f = await fixture(); const before = await candidateRow(f.candidates[0]!.id);
      await denied(() => updateCandidateManualClassification(actor(), f.source.id, before.id, bad, db), 400);
      assert.deepEqual(await candidateRow(before.id), before);
    });
  }
  it("PATCH validates inactive category before applying an otherwise valid business update", async () => {
    const f = await fixture(); const before = await candidateRow(f.candidates[0]!.id);
    await db.update(schema.knowledgeCategories).set({ isActive: false }).where(eq(schema.knowledgeCategories.id, f.categoryId));
    await denied(() => updateCandidateManualClassification(actor(), f.source.id, before.id,
      { requestedProjectCode: "other", knowledgeCategoryId: f.categoryId }, db), 400);
    assert.deepEqual(await candidateRow(before.id), before);
  });

  it("two actors reach the conversion pre-commit barrier and return one canonical Article", async () => {
    const f = await fixture(); await prepare(f); const rendezvous = barrier(2);
    const racingDb = batchHook(async (queries) => { if (hasSql(queries, 'insert into "knowledge_articles"')) await rendezvous(); });
    const [a, b] = await Promise.all([convert(f, racingDb), convert(f, racingDb, 0, adminActor())]);
    assert.equal(a.id, b.id); assert.deepEqual(await counts(), one);
    assert.equal((await convert(f)).id, a.id);
    const row = await candidateRow(f.candidates[0]!.id);
    assert.equal(row.draftArticleId, a.id); assert.ok(row.convertedAt);
  });
  for (const [name, operation] of [
    ["Article", "BEFORE INSERT ON knowledge_articles"],
    ["version", "BEFORE INSERT ON knowledge_article_versions"],
    ["audit", "BEFORE INSERT ON audit_logs WHEN NEW.action = 'knowledge_article_create'"],
    ["linkage", "BEFORE UPDATE OF draft_article_id ON knowledge_source_segment_candidates WHEN NEW.draft_article_id IS NOT NULL"],
  ]) {
    it(`failure at ${name} rolls back Article/version/audit/linkage and retry succeeds`, async () => {
      const f = await fixture(); await prepare(f); const before = await candidateRow(f.candidates[0]!.id);
      await db.run(sql.raw(`CREATE TRIGGER candidate_remediation_fault ${operation} BEGIN SELECT RAISE(ABORT, 'local injected failure'); END`));
      await assert.rejects(() => convert(f));
      assert.deepEqual(await counts(), zero); assert.deepEqual(await candidateRow(before.id), before);
      await db.run(sql`DROP TRIGGER candidate_remediation_fault`);
      await convert(f); assert.deepEqual(await counts(), one);
    });
  }
  it("lost batch response after commit recovers the canonical linkage", async () => {
    const f = await fixture(); await prepare(f); let conversionBatch = false;
    const uncertain = batchHook(async (queries) => { conversionBatch = hasSql(queries, 'insert into "knowledge_articles"'); },
      () => { if (conversionBatch) throw new Error("local response lost after commit"); });
    const article = await convert(f, uncertain);
    assert.equal((await convert(f)).id, article.id); assert.deepEqual(await counts(), one);
  });
  it("re-analysis wins against a conversion already at its pre-commit boundary", async () => {
    const f = await fixture(); await prepare(f); const entered = deferred(); const release = deferred();
    const paused = batchHook(async (queries) => { if (hasSql(queries, 'insert into "knowledge_articles"')) { entered.resolve(); await release.promise; } });
    const result = convert(f, paused).then(() => null, (error: unknown) => error);
    await entered.promise;
    await startKnowledgeSourceAnalysis(actor(), f.source.id, META, db);
    release.resolve(); assert.ok(await result instanceof KnowledgeServiceError);
    assert.deepEqual(await counts(), zero);
    assert.equal((await candidateRow(f.candidates[0]!.id)).status, "superseded");
  });
  it("conversion wins against re-analysis after its earlier converted check", async () => {
    const f = await fixture(); await prepare(f); const entered = deferred(); const release = deferred();
    const paused = batchHook(async (queries) => { if (hasSql(queries, 'insert into "knowledge_source_analysis_runs"')) { entered.resolve(); await release.promise; } });
    const result = startKnowledgeSourceAnalysis(actor(), f.source.id, META, paused).then(() => null, (error: unknown) => error);
    await entered.promise; await convert(f); release.resolve();
    assert.ok(await result instanceof KnowledgeServiceError); assert.deepEqual(await counts(), one);
    assert.equal((await candidateRow(f.candidates[0]!.id)).status, "ready");
    assert.equal((await db.select().from(schema.knowledgeSourceSegments))[0]!.status, "confirmed");
    assert.equal((await db.select().from(schema.knowledgeSourceAnalysisRuns)).length, 1);
  });
  for (const transition of ["re-analysis", "rejected", "proposed", "archived", "ineligible"] as const) {
    it(`late organizer completion cannot revive a ${transition} candidate`, async () => {
      const f = await fixture(); const entered = deferred(); const release = deferred();
      const pending = organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db, {
        execute: async (input, database) => { entered.resolve(); await release.promise; return executeKnowledgeOrganizationOnEvidence(input, database); },
      }).then(() => null, (error: unknown) => error);
      await entered.promise;
      if (transition === "re-analysis") await startKnowledgeSourceAnalysis(actor(), f.source.id, META, db);
      else if (transition === "rejected" || transition === "proposed") await updateKnowledgeSourceSegmentStatus(actor(), f.source.id, f.segments[0]!.id, transition, META, db);
      else await db.update(schema.knowledgeSources).set(transition === "archived" ? { archivedAt: new Date().toISOString() } : { status: "failed" }).where(eq(schema.knowledgeSources.id, f.source.id));
      const before = await candidateRow(f.candidates[0]!.id);
      release.resolve(); assert.ok(await pending instanceof KnowledgeServiceError);
      assert.deepEqual(await candidateRow(before.id), before);
      assert.equal((await latestCandidateOrganization(before.id, db))!.status, "failed");
      assert.equal((await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "knowledge_ai_organization_completed"))).length, 0);
    });
  }
  for (const status of ["proposed", "rejected"] as const) {
    it(`confirmed → ${status} rejects old comparison and conversion`, async () => {
      const f = await fixture(); const { organization } = await prepare(f);
      await updateKnowledgeSourceSegmentStatus(actor(), f.source.id, f.segments[0]!.id, status, META, db);
      await denied(() => compareKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id,
        { ...DRAFT, organizationRunId: organization.id }, META, db, { candidates: [] }), 409);
      await denied(() => convert(f), 409); assert.deepEqual(await counts(), zero);
    });
  }
  it("archive after conversion validation prevents the whole batch", async () => {
    const f = await fixture(); await prepare(f);
    const changed = batchHook(async (queries) => {
      if (!hasSql(queries, 'insert into "knowledge_articles"')) return;
      const source = (await db.select().from(schema.knowledgeSources).where(eq(schema.knowledgeSources.id, f.source.id)))[0]!;
      await archiveKnowledgeSource(actor(), source.id, source.updatedAt, META, db);
    });
    await denied(() => convert(f, changed), 409); assert.deepEqual(await counts(), zero);
  });
  it("comparison completion rechecks the current organization inside its batch", async () => {
    const f = await fixture();
    await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
    const organization = (await latestCandidateOrganization(f.candidates[0]!.id, db))!;
    const changed = batchHook(async (queries) => {
      if (hasSql(queries, 'update "knowledge_ai_comparison_runs"')) {
        await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
      }
    });
    await denied(() => compareKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id,
      { ...DRAFT, organizationRunId: organization.id }, META, changed, { candidates: [] }), 409);
    assert.equal((await db.select().from(schema.knowledgeAiComparisonRuns))[0]!.status, "failed");
    assert.equal((await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "knowledge_comparison_completed"))).length, 0);
  });
  it("candidate comparison rejects another candidate's completed organization", async () => {
    const f = await fixture(THREE);
    for (const candidate of f.candidates.slice(0, 2)) await organizeKnowledgeSegmentCandidate(actor(), f.source.id, candidate.id, META, db);
    const unrelated = (await latestCandidateOrganization(f.candidates[1]!.id, db))!;
    await denied(() => compareKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id,
      { ...DRAFT, organizationRunId: unrelated.id }, META, db, { candidates: [] }), 409);
    assert.equal((await db.select().from(schema.knowledgeAiComparisonRuns)).length, 0);
  });
  it("reorganization invalidates both old compared content and the old browser organization ID", async () => {
    const f = await fixture(); const { organization } = await prepare(f);
    await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
    await denied(() => convert(f), 409);
    await denied(() => compareKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id,
      { ...DRAFT, organizationRunId: organization.id }, META, db, { candidates: [] }), 409);
    assert.deepEqual(await counts(), zero);
  });
  for (const humanChange of ["category", "business"] as const) {
    it(`late high-confidence AI cannot overwrite a newer manual ${humanChange}`, async () => {
      const f = await fixture(); await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
      const humanCategory = await category("人工分类"); const entered = deferred(); const release = deferred();
      const pending = automaticDraft(f, high(f.categoryId), async () => { entered.resolve(); await release.promise; });
      await entered.promise;
      await updateCandidateManualClassification(actor(), f.source.id, f.candidates[0]!.id,
        humanChange === "category" ? { knowledgeCategoryId: humanCategory } : { requestedProjectCode: "other" }, db);
      const before = await candidateRow(f.candidates[0]!.id);
      release.resolve(); await pending; assert.deepEqual(await candidateRow(before.id), before);
    });
  }
  it("old evidence/mapping snapshot cannot reset newer manual business/category flags", async () => {
    const f = await fixture(); const snapshot = await candidateRow(f.candidates[0]!.id);
    await updateCandidateManualClassification(actor(), f.source.id, snapshot.id,
      { requestedProjectCode: "other", knowledgeCategoryId: f.categoryId }, db);
    const before = await candidateRow(snapshot.id);
    await applyCandidateBusinessFromEvidence(snapshot, TEXT, db);
    assert.deepEqual(await candidateRow(snapshot.id), before);
  });
  for (const result of [
    { status: "suggested", confidenceBand: "medium", requiresConfirmation: true },
    { status: "insufficient_confidence", confidenceBand: "low", requiresConfirmation: false },
    { status: "error", requiresConfirmation: false },
  ] as const) {
    it(`${result.status}/${"confidenceBand" in result ? result.confidenceBand : "error"} clears a previous automatic fill`, async () => {
      const f = await fixture(); await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
      await automaticDraft(f, high(f.categoryId));
      assert.equal((await candidateRow(f.candidates[0]!.id)).knowledgeCategoryId, f.categoryId);
      await automaticDraft(f, { ...result, categoryId: f.categoryId, categoryName: "AI分类", resolutionSource: result.status === "suggested" ? "ai_suggestion" : null });
      const row = await candidateRow(f.candidates[0]!.id);
      assert.equal(row.knowledgeCategoryId, null); assert.equal(row.manualCategoryOverride, false);
    });
  }
  it("category deactivation while AI is pending prevents auto-fill", async () => {
    const f = await fixture(); await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
    const entered = deferred(); const release = deferred();
    const pending = automaticDraft(f, high(f.categoryId), async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    await db.update(schema.knowledgeCategories).set({ isActive: false }).where(eq(schema.knowledgeCategories.id, f.categoryId));
    release.resolve(); await pending; assert.equal((await candidateRow(f.candidates[0]!.id)).knowledgeCategoryId, null);
  });
  it("mapping deactivation before draft sync clears the stale mapped category", async () => {
    const f = await fixture(); const code = REQUESTED_PROJECT_ITEMS[0]!.code; const now = new Date().toISOString();
    await updateCandidateManualClassification(actor(), f.source.id, f.candidates[0]!.id, { requestedProjectCode: code }, db);
    await db.insert(schema.knowledgeBusinessCategoryMappings).values({ id: crypto.randomUUID(), requestedProjectCode: code,
      knowledgeCategoryId: f.categoryId, isActive: true, createdAt: now, updatedAt: now });
    await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
    const snapshot = await detail(f); const run = (await latestCandidateOrganization(snapshot.id, db))!;
    const draft = await buildCandidateOrganizerDraft(actor(), f.source.id, snapshot, {}, db);
    assert.equal(draft.categoryId, f.categoryId);
    await db.update(schema.knowledgeBusinessCategoryMappings).set({ isActive: false });
    await syncCandidateCategoryFromOrganizerDraft(snapshot, draft, db, run.id);
    assert.equal((await candidateRow(snapshot.id)).knowledgeCategoryId, null);
  });
  it("source compare excludes newer candidate runs; candidate compare rejects a source-level run ID", async () => {
    const f = await fixture();
    await organizeKnowledgeSource(actor(), f.source.id, META, db);
    const sourceOrg = (await db.select().from(schema.knowledgeAiOrganizationRuns).where(sql`candidate_id IS NULL`))[0]!;
    await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
    const candidateOrg = (await latestCandidateOrganization(f.candidates[0]!.id, db))!;
    const legacy = await compareKnowledgeSource(actor(), f.source.id, META, db, { candidates: [] });
    assert.equal(legacy.candidateId, null); assert.equal(legacy.organizationRunId, sourceOrg.id);
    await denied(() => compareKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id,
      { ...DRAFT, organizationRunId: sourceOrg.id }, META, db, { candidates: [] }), 409);
    const candidate = await compareKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id,
      { ...DRAFT, organizationRunId: candidateOrg.id }, META, db, { candidates: [] });
    assert.equal(candidate.organizationRunId, candidateOrg.id);
  });
  it("legacy review source readiness excludes a newer failed candidate run", async () => {
    const f = await fixture();
    await organizeKnowledgeSource(actor(), f.source.id, META, db);
    await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
    const candidateRun = (await latestCandidateOrganization(f.candidates[0]!.id, db))!;
    await db.update(schema.knowledgeAiOrganizationRuns).set({ status: "failed" })
      .where(eq(schema.knowledgeAiOrganizationRuns.id, candidateRun.id));
    const article = await createKnowledgeArticle(actor(), { ...DRAFT, categoryId: f.categoryId }, META, db);
    await db.update(schema.knowledgeSources).set({ linkedArticleId: article.id, status: "converted" })
      .where(eq(schema.knowledgeSources.id, f.source.id));
    const review = await submitKnowledgeReview(actor(), { articleId: article.id }, META, db);
    assert.equal(review.linkedSourceId, f.source.id);
    assert.equal(review.linkedSourceOrganizationReady, true);
  });
  it("reorganization keeps a converted Article and sequential replay returns its canonical ID", async () => {
    const f = await fixture(); await prepare(f);
    const article = await convert(f);
    await organizeKnowledgeSegmentCandidate(actor(), f.source.id, f.candidates[0]!.id, META, db);
    assert.equal((await convert(f)).id, article.id);
    assert.deepEqual(await counts(), one);
    await denied(() => updateCandidateManualClassification(actor(), f.source.id, f.candidates[0]!.id,
      { requestedProjectCode: "other" }, db), 409);
  });
  it("one source → three candidates → three Articles → stable correct Open Draft IDs", async () => {
    const f = await fixture(THREE); assert.equal(f.candidates.length, 3);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) { await prepare(f, i); ids.push((await convert(f, db, i)).id); }
    assert.equal(new Set(ids).size, 3);
    assert.deepEqual(await counts(), { articles: 3, versions: 3, audits: 3, links: 3 });
    const refreshed = await listKnowledgeSegmentCandidates(actor(), f.source.id, db);
    for (let i = 0; i < refreshed.length; i++) {
      const id = resolveCandidateDraftArticleId(refreshed[i]!, {});
      assert.equal(id, ids[i]); assert.equal(knowledgeArticleDetailPath(id!), `/knowledge/articles/${ids[i]}`);
    }
    assert.equal((await db.select().from(schema.knowledgeSources))[0]!.linkedArticleId, null);
  });
  it("parallel materialization keeps one candidate per segment", async () => {
    const f = await fixture(); await db.delete(schema.knowledgeSourceSegmentCandidates);
    await Promise.all([materializeKnowledgeSegmentCandidatesForSource(actor(), f.source.id, db),
      materializeKnowledgeSegmentCandidatesForSource(actor(), f.source.id, db)]);
    assert.equal((await listKnowledgeSegmentCandidates(actor(), f.source.id, db)).length, 1);
  });
});
