import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import {
  formatAssignedReviewerLabel,
  formatKnowledgeReviewStatus,
  formatKnowledgeVisibility,
} from "@/lib/knowledge/review-labels";
import en from "@/i18n/locales/en";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const t = (key: string) => {
  const parts = key.split(".");
  let value: unknown = en;
  for (const part of parts) {
    value = (value as Record<string, unknown>)[part];
  }
  return String(value);
};

describe("Knowledge workflow UX stabilization", () => {
  it("adds localized back navigation on secondary Knowledge pages", () => {
    assert.match(read("src/app/(dashboard)/knowledge/ingest/page.tsx"), /KnowledgeBackLinkLocalized/);
    assert.match(
      read("src/app/(dashboard)/knowledge/ingest/page.tsx"),
      /labelKey="knowledge\.article\.backToKnowledge"/,
    );
    assert.match(read("src/app/(dashboard)/knowledge/review/page.tsx"), /KnowledgeBackLinkLocalized/);
    assert.match(
      read("src/app/(dashboard)/knowledge/members/page.tsx"),
      /KnowledgeMembersBackLink/,
    );
    assert.match(
      read("src/app/(dashboard)/knowledge/articles/[id]/edit/page.tsx"),
      /labelKey="knowledge\.article\.backToArticle"/,
    );
    assert.match(
      read("src/app/(dashboard)/knowledge/articles/[id]/history/page.tsx"),
      /KnowledgeArticleHistoryClient/,
    );
    assert.match(
      read("src/app/(dashboard)/knowledge/articles/new/page.tsx"),
      /labelKey="knowledge\.article\.backToKnowledge"/,
    );
  });

  it("shows role-aware home actions and removes duplicate list search", () => {
    const home = read("src/components/knowledge/knowledge-home-client.tsx");
    assert.match(home, /knowledge\.home\.myReviews/);
    assert.match(home, /knowledge\.home\.reviewCenter/);
    assert.match(
      home,
      /canAuthor[\s\S]*knowledge\.home\.newDraft/,
    );
    assert.doesNotMatch(home, /按标题或分类筛选/);
    assert.doesNotMatch(home, /归档文章/);
  });

  it("limits article detail actions by role", () => {
    const page = read("src/app/(dashboard)/knowledge/articles/[id]/page.tsx");
    assert.match(page, /canReviewInCenter/);
    assert.match(page, /showMyReviews = actor\.role === "contributor"/);
    assert.match(page, /KnowledgeArticleReviewStatus/);
    assert.match(page, /canShowKnowledgeArticleEditCta/);
    assert.match(page, /canShowEdit={canShowEdit}/);
    assert.match(
      read("src/components/knowledge/knowledge-article-review-status.tsx"),
      /knowledge\.article\.changesRequestedTitle/,
    );
    assert.doesNotMatch(page, /role === "reviewer"[\s\S]*编辑文章/);
    assert.doesNotMatch(page, /canEdit &&[\s\S]*编辑文章/);
  });

  it("removes reviewer edit/archive affordances from editor and history", () => {
    const editor = read("src/components/knowledge/knowledge-article-editor.tsx");
    const history = read("src/components/knowledge/knowledge-article-history-client.tsx");
    assert.doesNotMatch(editor, /role === "reviewer"/);
    assert.doesNotMatch(editor, /归档/);
    assert.doesNotMatch(history, /Package 2/);
    assert.doesNotMatch(history, /编辑文章/);
    assert.match(history, /knowledge\.article\.historyDescription/);
  });

  it("polishes review center labels and contributor tabs", () => {
    const center = read("src/components/knowledge/knowledge-review-center-client.tsx");
    assert.match(center, /formatKnowledgeReviewStatus/);
    assert.match(center, /formatKnowledgeVisibility/);
    assert.match(center, /knowledge\.review\.unassignedQueueHint/);
    assert.match(center, /knowledge\.review\.viewArticle/);
    assert.match(center, /role === "contributor"/);
    assert.doesNotMatch(center, /\{review\.status\}/);
  });

  it("uses localized ingest intro and removes members duplicate description", () => {
    assert.match(
      read("src/app/(dashboard)/knowledge/ingest/page.tsx"),
      /titleKey="knowledge\.ingest\.pageTitle"/,
    );
    const members = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.doesNotMatch(members, /knowledge\.members\.description/);
  });

  it("maps review and visibility enums through locale keys", () => {
    assert.equal(
      formatKnowledgeReviewStatus("changes_requested", t),
      en.knowledge.labels.reviewStatus.changes_requested,
    );
    assert.equal(
      formatKnowledgeVisibility("team", t),
      en.knowledge.labels.visibility.team,
    );
    assert.equal(
      formatAssignedReviewerLabel(null, t),
      en.knowledge.labels.reviewerQueue,
    );
  });
});
