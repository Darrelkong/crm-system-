import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  knowledgeArticleDetailPath,
  resolveCandidateDraftArticleId,
} from "@/lib/knowledge/knowledge-article-paths";

const root = process.cwd();
const workflow = readFileSync(
  join(root, "src/components/knowledge/knowledge-smart-ingest-candidate-workflow.tsx"),
  "utf8",
);
const convertRoute = readFileSync(
  join(
    root,
    "src/app/api/knowledge/sources/[id]/candidates/[candidateId]/convert/route.ts",
  ),
  "utf8",
);

const hsbcId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const bochkId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const chaseId = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("knowledge candidate open draft navigation (2E-6B)", () => {
  it("A: converted Candidate DTO field draftArticleId resolves navigation id", () => {
    const id = resolveCandidateDraftArticleId(
      { id: "cand-hsbc", draftArticleId: hsbcId },
      {},
    );
    assert.equal(id, hsbcId);
  });

  it("B: three converted Candidates expose three distinct draftArticleIds", () => {
    const saved = {
      "cand-hsbc": hsbcId,
      "cand-bochk": bochkId,
      "cand-chase": chaseId,
    };
    const ids = [
      resolveCandidateDraftArticleId({ id: "cand-hsbc", draftArticleId: hsbcId }, saved),
      resolveCandidateDraftArticleId({ id: "cand-bochk", draftArticleId: bochkId }, saved),
      resolveCandidateDraftArticleId({ id: "cand-chase", draftArticleId: chaseId }, saved),
    ];
    assert.deepEqual(new Set(ids).size, 3);
  });

  it("C–F: Open Draft targets use per-candidate draftArticleId", () => {
    assert.equal(knowledgeArticleDetailPath(hsbcId), `/knowledge/articles/${hsbcId}`);
    assert.equal(knowledgeArticleDetailPath(bochkId), `/knowledge/articles/${bochkId}`);
    assert.equal(knowledgeArticleDetailPath(chaseId), `/knowledge/articles/${chaseId}`);
    assert.match(workflow, /knowledgeArticleDetailPath\(savedId\)/);
    assert.match(workflow, /data-candidate-open-draft-article-id=\{savedId\}/);
    assert.match(workflow, /data-candidate-open-draft-candidate-id=\{candidate\.id\}/);
  });

  it("G: reload hydration uses candidate.draftArticleId from GET list", () => {
    assert.match(workflow, /candidate\.draftArticleId/);
    assert.match(workflow, /resolveCandidateDraftArticleId/);
    assert.doesNotMatch(workflow, /linkedArticleId/);
  });

  it("H: does not use source.linked_article_id", () => {
    assert.doesNotMatch(workflow, /linkedArticleId/);
    assert.doesNotMatch(workflow, /linked_article_id/);
  });

  it("I: Open Draft is navigation only, not convert", () => {
    const openDraftBlock = workflow.slice(
      workflow.indexOf("data-candidate-open-draft-link"),
      workflow.indexOf("data-candidate-convert-button"),
    );
    assert.doesNotMatch(openDraftBlock, /\/convert/);
    assert.doesNotMatch(openDraftBlock, /runConvert/);
  });

  it("J: convert API still returns article id and draftArticleId", () => {
    assert.match(convertRoute, /draftArticleId: article\.id/);
    assert.match(convertRoute, /candidateId/);
  });

  it("K: mobile-friendly anchor tap target, not disabled nested control", () => {
    assert.match(workflow, /<a[\s\S]*data-candidate-open-draft-link/);
    assert.match(workflow, /min-h-11/);
    assert.doesNotMatch(workflow, /pointer-events-none/);
    assert.doesNotMatch(workflow, /disabled=\{true\}[\s\S]*Open draft/);
  });
});
