import React, { StrictMode, act, useState } from "react";
import { createRoot } from "react-dom/client";
import { KnowledgeSmartIngestAnalysisSection } from "@/components/knowledge/knowledge-smart-ingest-analysis-section";
import type { CandidateDraftState } from "@/components/knowledge/knowledge-smart-ingest-candidate-workflow";
import type { KnowledgeSegmentCandidateDetail } from "@/lib/knowledge/knowledge-segment-candidate-service";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";
import { deriveSmartIngestSourceScope, type SmartIngestSourceScope } from "@/lib/knowledge/smart-ingest-source-scope";
import { I18nProvider } from "@/i18n/provider";
import en from "@/i18n/locales/en";

type Drafts = Record<string, CandidateDraftState>;
declare global {
  interface Window {
    __candidateLifecycle: { notifications: number; observe: (value: Drafts) => void };
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
}
window.IS_REACT_ACT_ENVIRONMENT = true;
localStorage.setItem("crm_locale", "en");
const originalFetch = window.fetch.bind(window);
const errors: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); originalError(...args); };
const results: string[] = [];
function check(ok: unknown, message: string): void { if (!ok) throw new Error(message); results.push(message); }
const now = "2026-09-30T00:00:00.000Z";
const candidates: KnowledgeSegmentCandidateDetail[] = ["a", "b"].map((id, index) => ({
  id, sourceId: "fixture", segmentId: `segment-${id}`, analysisRunId: "run", segmentIndex: index,
  status: "pending", requestedProjectCode: null, knowledgeCategoryId: null, categoryResolutionSource: null,
  manualRequestedProjectOverride: false, manualCategoryOverride: false, createdAt: now, updatedAt: now,
  supersededAt: null, supersededByAnalysisRunId: null, segmentTitleHint: `Topic ${id}`,
  segmentEvidenceText: `Synthetic evidence ${id}`, segmentStatus: "confirmed", organizationStatus: null,
  organizationFailureCode: null, organizationCompleted: false, draftArticleId: null, convertedAt: null,
}));
const source: KnowledgeSourceDetail = {
  id: "fixture", sourceType: "paste", sourceTitle: "Synthetic lifecycle", originalFilename: null,
  mimeType: null, sizeBytes: null, status: "ready", analysisStatus: "ready_for_review", failureCode: null,
  linkedArticleId: null, createdByUserId: "synthetic", archivedAt: null, archivedByUserId: null,
  createdAt: now, updatedAt: now, processedAt: now, rawText: "Synthetic evidence", storageKey: null,
  contentHash: "synthetic", extractionMethod: null, extractionModel: null, extractionMetadata: null,
  pageCount: null, organization: null,
  smartIngestScope: deriveSmartIngestSourceScope({ analysisStatus: "ready_for_review", latestAnalysisRunId: "run",
    segments: candidates.map(c => ({ id: c.segmentId, segmentIndex: c.segmentIndex, titleHint: c.segmentTitleHint,
      evidenceText: c.segmentEvidenceText, evidenceStart: 0, evidenceEnd: 20, status: "confirmed" })) }),
};

const segments = candidates.map(c => ({ id: c.segmentId, segmentIndex: c.segmentIndex,
  titleHint: c.segmentTitleHint, evidenceText: c.segmentEvidenceText, evidenceStart: 0,
  evidenceEnd: 20, status: "proposed" as "proposed" | "confirmed", createdAt: now }));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
const noop = () => {};
async function settle() { await act(async () => { await new Promise(r => setTimeout(r, 20)); }); }
async function until(predicate: () => boolean) {
  for (let i = 0; i < 50 && !predicate(); i++) await settle();
  if (!predicate()) throw new Error("Fixture did not settle");
}
function click(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button || button.disabled) throw new Error(`Control unavailable: ${selector}`);
  button.click();
}
async function scenario(strict: boolean, mode: "healthy" | "mismatch" | "emptyMismatch" | "failure" | "partial") {
  segments.forEach(s => { s.status = "proposed"; });
  const calls: string[] = [];
  const secondPatch = deferred(); const materializing = deferred();
  let persisted: KnowledgeSegmentCandidateDetail[] = [];
  let renders = 0; let mismatchSeen = false; let latestScope: SmartIngestSourceScope | null = null;
  window.__candidateLifecycle = { notifications: 0, observe() {
    if (++renders > 150) throw new Error("Unbounded render lifecycle");
  } };
  const observer = new MutationObserver(() => {
    if (document.querySelector('[data-candidate-count-mismatch]')) mismatchSeen = true;
  });
  observer.observe(document.getElementById("mount")!, { subtree: true, childList: true });
  window.fetch = async (input, init) => {
    const url = String(input); const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (url.startsWith('/locales/')) return Response.json(en);
    if (url.endsWith('/analyze')) return Response.json({ runId: 'run', status: 'completed' });
    if (url.endsWith('/analysis-runs/run')) return Response.json({ run: {
      id: 'run', status: 'completed', segments: segments.map(s => ({ ...s })), failureMessage: null,
    } });
    if (url.includes('/segments/')) {
      const index = url.endsWith('segment-a') ? 0 : 1;
      if (index === 1) await secondPatch.promise;
      if (index === 1 && mode === 'partial') return Response.json({ error: 'Synthetic confirmation failed' }, { status: 503 });
      segments[index].status = 'confirmed';
      return Response.json({ segment: { ...segments[index] } });
    }
    if (url.endsWith('/candidates') && method === 'GET') return Response.json({ candidates: persisted });
    if (url.endsWith('/candidates') && method === 'POST') {
      await materializing.promise;
      if (mode === 'failure') return Response.json({ error: 'Synthetic materialization failed' }, { status: 503 });
      persisted = candidates.filter((_, i) => segments[i].status === 'confirmed').slice(0, mode === 'emptyMismatch' ? 0 : mode === 'mismatch' ? 1 : 2);
      return Response.json({ candidates: persisted });
    }
    if (url.endsWith('/comparison')) return Response.json({ comparison: null });
    throw new Error(`Unexpected fixture request: ${method} ${url}`);
  };
  let root = createRoot(document.getElementById('mount')!);
  let currentSource = { ...source, analysisStatus: 'none' as KnowledgeSourceDetail['analysisStatus'],
    smartIngestScope: deriveSmartIngestSourceScope({ analysisStatus: 'none', latestAnalysisRunId: null, segments: [] }) };
  function Parent() {
    const [scope, setScope] = useState<SmartIngestSourceScope | null>(null);
    latestScope = scope;
    return <><output data-parent-count>{scope?.confirmedSegmentCount ?? 0}</output>
      <KnowledgeSmartIngestAnalysisSection source={currentSource} categories={[]} locale="en"
        onAnalysisStatusChange={noop} onScopeChange={setScope} /></>;
  }
  const tree = () => { const child = <I18nProvider><Parent /></I18nProvider>; return strict ? <StrictMode>{child}</StrictMode> : child; };
  const label = `${strict ? 'StrictMode' : 'normal'} ${mode}`;
  try {
    await act(async () => root.render(tree()));
    await until(() => !!document.querySelector('[data-analyze-content-button]'));
    await act(async () => click('[data-analyze-content-button]'));
    await until(() => !!document.querySelector('[data-segment-confirm-all]'));
    check(document.querySelectorAll('[data-segment-status="proposed"]').length === 2, `${label}: analysis has two proposed topics`);
    await act(async () => click('[data-segment-confirm-all]'));
    await until(() => segments[0].status === 'confirmed'); await settle();
    check(!calls.some(c => c.includes('/candidates')), `${label}: no intermediate-count candidate refresh during confirmation`);
    check(!mismatchSeen, `${label}: pending confirmation is not a mismatch`);
    await act(async () => secondPatch.resolve());
    await until(() => calls.some(c => c.startsWith('POST') && c.endsWith('/candidates')));
    check(!mismatchSeen, `${label}: pending materialization is not a mismatch`);
    await act(async () => materializing.resolve());
    await settle(); await settle();
    const expected = mode === 'partial' ? 1 : 2;
    check(document.querySelector('[data-parent-count]')?.textContent === String(expected), `${label}: committed confirmation count reaches parent`);
    check(calls.filter(c => c.startsWith('PATCH')).length === 2, `${label}: exactly two confirmation attempts`);
    if (mode === 'failure') {
      check(document.body.textContent?.includes(en.knowledge.ingest.smartIngestCandidatesLoadFailed), `${label}: backend failure remains visible`);
    } else if ((mode === 'mismatch' || mode === 'emptyMismatch')) {
      check(!!document.querySelector('[data-candidate-count-mismatch]'), `${label}: genuine unresolved mismatch remains visible`);
    } else {
      check(document.querySelectorAll('[data-candidate-organize-button]').length === expected && !mismatchSeen,
        `${label}: correct independent candidate count without false mismatch`);
      if (mode === 'partial') check(document.body.textContent?.includes(en.knowledge.ingest.failure), `${label}: partial confirmation error remains visible`);
      check(new Set(persisted.map(c => c.segmentId)).size === expected, `${label}: distinct candidate identities`);
      const scope = latestScope!;
      await act(async () => root.unmount());
      root = createRoot(document.getElementById('mount')!);
      currentSource = { ...source, smartIngestScope: scope };
      await act(async () => root.render(tree()));
      await until(() => document.querySelectorAll('[data-candidate-organize-button]').length === expected);
      check(!mismatchSeen, `${label}: reload retains candidates without false mismatch`);
      check(calls.filter(c => c.startsWith('POST') && c.endsWith('/candidates')).length === 1, `${label}: reload does not rematerialize candidates`);
    }
    const count = calls.length; const renderCount = renders;
    await settle(); await settle();
    check(count === calls.length && renderCount === renders, `${label}: quiet bounded settled state`);
    return { label, renders, calls };
  } finally { observer.disconnect(); await act(async () => root.unmount()); }
}

async function staleRefreshScenario(strict: boolean, failure = false) {
  const oldRead = deferred(); const calls: string[] = [];
  const oldSegments = segments.map((segment, i) => ({ ...segment, status: i === 0 ? "confirmed" as const : "proposed" as const }));
  const value = { ...source, smartIngestScope: deriveSmartIngestSourceScope({ analysisStatus: "ready_for_review", latestAnalysisRunId: "run", segments: oldSegments }) };
  let renders = 0; let delayed = false;
  window.__candidateLifecycle = { notifications: 0, observe() { if (++renders > 100) throw new Error('Runaway stale-refresh rendering'); } };
  window.fetch = async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET'; calls.push(`${method} ${url}`);
    if (url.startsWith('/locales/')) return Response.json(en);
    if (url.includes('/segments/')) return Response.json({ segment: { ...oldSegments[1], status: 'confirmed' } });
    if (url.endsWith('/comparison')) return Response.json({ comparison: null });
    if (url.endsWith('/candidates') && method === 'GET') {
      // Delay all mount/StrictMode reads until after the human confirms topic B.
      if (!calls.some(call => call.startsWith('PATCH'))) { delayed = true; if (!failure) await oldRead.promise; return Response.json({ candidates: [candidates[0]] }); }
      if (failure) return Response.json({error:'Synthetic refresh failure'}, {status:503});
      return Response.json({ candidates });
    }
    throw new Error(`Unexpected stale-refresh request: ${method} ${url}`);
  };
  function Parent() {
    const [scope, setScope] = useState<SmartIngestSourceScope | null>(null);
    return <><output>{scope?.confirmedSegmentCount}</output><KnowledgeSmartIngestAnalysisSection
      source={value} categories={[]} locale="en" onAnalysisStatusChange={noop} onScopeChange={setScope} /></>;
  }
  const root = createRoot(document.getElementById('mount')!);
  const label = `${strict ? 'StrictMode' : 'normal'} ${failure ? 'refresh failure with existing card' : 'late obsolete read'}`;
  try {
    const child = <I18nProvider><Parent /></I18nProvider>;
    await act(async () => root.render(strict ? <StrictMode>{child}</StrictMode> : child));
    await until(() => delayed);
    if (failure) await until(() => document.querySelectorAll('[data-candidate-organize-button]').length === 1);
    await act(async () => {
      const keep = [...document.querySelectorAll<HTMLButtonElement>('[data-segment-keep-button]')].find(b => !b.disabled);
      if (!keep) throw new Error('Missing individual Keep'); keep.click();
    });
    if (failure) {
      await until(() => !!document.querySelector('[data-candidate-cards-error]'));
      check(document.querySelectorAll('[data-candidate-organize-button]').length === 1, `${label}: retains existing card`);
      check(document.body.textContent?.includes(en.knowledge.ingest.smartIngestCandidatesLoadFailed), `${label}: refresh error stays visible alongside retained card`);
      return {label, renders, calls};
    }
    await until(() => document.querySelectorAll('[data-candidate-organize-button]').length === 2);
    check(!document.querySelector('[data-candidate-count-mismatch]'), `${label}: individual confirmation settles at two`);
    await act(async () => oldRead.resolve()); await settle();
    check(document.querySelectorAll('[data-candidate-organize-button]').length === 2 && !document.querySelector('[data-candidate-count-mismatch]'), `${label}: late one-candidate snapshot cannot overwrite current result`);
    check(!calls.some(c => c.startsWith('POST')), `${label}: obsolete read cannot trigger materialization`);
    return { label, renders, calls };
  } finally { oldRead.resolve(); await act(async () => root.unmount()); }
}
void (async () => {
  const counts = [];
  try {
    for (const strict of [false, true]) for (const mode of ['healthy', 'mismatch', 'emptyMismatch', 'failure', 'partial'] as const) counts.push(await scenario(strict, mode));
    for (const strict of [false, true]) { counts.push(await staleRefreshScenario(strict)); counts.push(await staleRefreshScenario(strict, true)); }
    check(errors.length === 0, 'No React render-phase or update-depth errors');
    return { ok: true, results, counts, errors };
  } catch (error) { return { ok: false, results, counts, errors, error: String(error) }; }
})().then(async result => {
  document.getElementById('result')!.textContent = JSON.stringify(result, null, 2);
  await originalFetch('/result', { method: 'POST', body: JSON.stringify(result) });
});
