import React, { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { KnowledgeSmartIngestAnalysisSection } from "@/components/knowledge/knowledge-smart-ingest-analysis-section";
import type { CandidateDraftState } from "@/components/knowledge/knowledge-smart-ingest-candidate-workflow";
import type { KnowledgeSegmentCandidateDetail } from "@/lib/knowledge/knowledge-segment-candidate-service";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";
import { deriveSmartIngestSourceScope } from "@/lib/knowledge/smart-ingest-source-scope";
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
const requests: string[] = [];
window.fetch = async (input, init) => {
  const url = String(input); requests.push(`${init?.method ?? "GET"} ${url}`);
  if (url.startsWith("/locales/")) return Response.json(en);
  if (url.endsWith("/candidates")) return Response.json({ candidates });
  if (url.endsWith("/comparison")) return Response.json({ comparison: null });
  if (url.endsWith("/organize")) {
    const id = url.split("/").at(-2);
    return Response.json({ organizationRunId: `organization-${id}`, draft: {
      title: `Title ${id}`, summary: `Summary ${id}`, body: `Body ${id}`, categoryId: "",
      requestedProjectCode: null, requestedProjectName: "", categoryNotice: "none", categoryResolutionSource: null,
      categoryResolutionStatus: null, categoryAiSuggestion: null, suggestedCategoryId: null,
      suggestedCategoryName: null, categoryAiRequiresConfirmation: false, categorySelectionRequired: false,
    } });
  }
  throw new Error(`Unexpected fixture request: ${url}`);
};
const noop = () => {};
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); }
async function scenario(strict: boolean) {
  let latest: Drafts = {};
  const identities = new Set<Drafts>();
  let renders = 0;
  window.__candidateLifecycle = { notifications: 0, observe(value) {
    latest = value; identities.add(value); renders++;
    // Test failure bound only; never present in application/runtime code.
    if (renders > 100) throw new Error("Unbounded candidate composition render cycle");
  } };
  const root = createRoot(document.getElementById("mount")!);
  const tree = (value: KnowledgeSourceDetail) => {
    const content = <I18nProvider><KnowledgeSmartIngestAnalysisSection source={value} categories={[]}
      locale="en" onAnalysisStatusChange={noop} /></I18nProvider>;
    return strict ? <StrictMode>{content}</StrictMode> : content;
  };
  const mode = strict ? "StrictMode" : "normal";
  try {
    await act(async () => root.render(tree(source)));
    for (let attempt = 0; attempt < 20 && !latest.b; attempt++) await settle();
    check(latest.a?.title === "" && latest.b?.organized === false, `${mode}: initial snapshots reach real parent`);
    const stable = { notifications: window.__candidateLifecycle.notifications, states: identities.size, renders };
    await settle();
    check(renders === stable.renders && window.__candidateLifecycle.notifications === stable.notifications,
      `${mode}: idle has no runaway renders/notifications`);
    await act(async () => root.render(tree({ ...source }))); await settle();
    check(window.__candidateLifecycle.notifications === stable.notifications && identities.size === stable.states,
      `${mode}: unchanged rerender preserves notifications and parent state identity`);
    for (const id of ["a", "b"]) {
      const before = window.__candidateLifecycle.notifications;
      await act(async () => document.querySelectorAll<HTMLButtonElement>("[data-candidate-organize-button]")[id === "a" ? 0 : 1].click());
      await settle();
      check(latest[id].title === `Title ${id}` && latest[id].organized && latest[id].organizationRunId === `organization-${id}`,
        `${mode}: real organizer state ${id} reaches parent`);
      check(window.__candidateLifecycle.notifications === before + 1, `${mode}: one notification for meaningful change ${id}`);
    }
    const b = latest.b;
    const input = document.querySelectorAll<HTMLInputElement>('[data-candidate-organized-title]')[0];
    const beforeEdit = window.__candidateLifecycle.notifications;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Human edited title A");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }); await settle();
    check(latest.a.title === "Human edited title A" && input.value === latest.a.title,
      `${mode}: real controlled editor change propagates`);
    check(latest.b === b && latest.b.title === "Title b", `${mode}: candidate A never overwrites B`);
    check(window.__candidateLifecycle.notifications === beforeEdit + 1, `${mode}: editor change notifies once`);
    const end = { notifications: window.__candidateLifecycle.notifications, renders, requests: requests.length };
    await settle(); await settle();
    check(renders === end.renders && requests.length === end.requests && window.__candidateLifecycle.notifications === end.notifications,
      `${mode}: final state and network remain quiet`);
    return { mode, renders, stateIdentities: identities.size, notifications: end.notifications };
  } finally { await act(async () => root.unmount()); }
}
async function run() {
  const counts = [];
  try {
    counts.push(await scenario(false)); counts.push(await scenario(true));
    check(errors.length === 0, "No React lifecycle errors");
    return { ok: true, results, counts, requests, errors };
  } catch (error) { return { ok: false, results, counts, error: String(error), requests, errors }; }
}
void run().then(async result => {
  document.getElementById("result")!.textContent = JSON.stringify(result, null, 2);
  await originalFetch("/result", { method: "POST", body: JSON.stringify(result) });
});
