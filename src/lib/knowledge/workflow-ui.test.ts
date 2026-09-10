import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import {
  formatAssignedReviewerLabel,
  formatKnowledgeReviewStatus,
  formatKnowledgeVisibility,
} from "@/lib/knowledge/review-labels";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Knowledge workflow UX stabilization", () => {
  it("adds back navigation on secondary Knowledge pages", () => {
    assert.match(read("src/app/(dashboard)/knowledge/ingest/page.tsx"), /返回 Knowledge/);
    assert.match(read("src/app/(dashboard)/knowledge/review/page.tsx"), /返回 Knowledge/);
    assert.match(read("src/app/(dashboard)/knowledge/members/page.tsx"), /返回 Knowledge/);
    assert.match(
      read("src/app/(dashboard)/knowledge/articles/[id]/edit/page.tsx"),
      /返回文章/,
    );
    assert.match(
      read("src/app/(dashboard)/knowledge/articles/[id]/history/page.tsx"),
      /返回文章/,
    );
    assert.match(
      read("src/app/(dashboard)/knowledge/articles/new/page.tsx"),
      /返回 Knowledge/,
    );
  });

  it("shows role-aware home actions and removes duplicate list search", () => {
    const home = read("src/components/knowledge/knowledge-home-client.tsx");
    assert.match(home, /我的审核 · My Reviews/);
    assert.match(home, /审核中心 · Review Center/);
    assert.match(
      home,
      /role === "contributor" \|\| role === "knowledge_admin"[\s\S]*新建草稿/,
    );
    assert.doesNotMatch(home, /按标题或分类筛选/);
    assert.doesNotMatch(home, /归档文章/);
  });

  it("limits article detail actions by role", () => {
    const page = read("src/app/(dashboard)/knowledge/articles/[id]/page.tsx");
    assert.match(page, /canReviewInCenter/);
    assert.match(page, /showMyReviews = actor\.role === "contributor"/);
    assert.match(page, /KnowledgeArticleReviewStatus/);
    assert.match(
      read("src/components/knowledge/knowledge-article-review-status.tsx"),
      /审核退回 · Changes requested/,
    );
    assert.doesNotMatch(page, /role === "reviewer"[\s\S]*编辑文章/);
  });

  it("removes reviewer edit/archive affordances from editor and history", () => {
    const editor = read("src/components/knowledge/knowledge-article-editor.tsx");
    const history = read("src/app/(dashboard)/knowledge/articles/[id]/history/page.tsx");
    assert.doesNotMatch(editor, /role === "reviewer"/);
    assert.doesNotMatch(editor, /归档/);
    assert.doesNotMatch(history, /Package 2/);
    assert.doesNotMatch(history, /编辑文章/);
    assert.match(history, /当前暂不支持一键恢复/);
  });

  it("polishes review center labels and contributor tabs", () => {
    const center = read("src/components/knowledge/knowledge-review-center-client.tsx");
    assert.match(center, /formatKnowledgeReviewStatus/);
    assert.match(center, /formatKnowledgeVisibility/);
    assert.match(center, /未指定审核人的请求会进入可用审核者的待审核队列/);
    assert.match(center, /查看文章/);
    assert.match(center, /role === "contributor"/);
    assert.doesNotMatch(center, /\{review\.status\}/);
  });

  it("uses bilingual ingest title and removes members duplicate description", () => {
    assert.match(read("src/app/(dashboard)/knowledge/ingest/page.tsx"), /资料整理 · Source Ingest/);
    const members = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.doesNotMatch(members, /knowledge\.members\.description/);
  });

  it("maps review and visibility enums to polished bilingual labels", () => {
    assert.equal(
      formatKnowledgeReviewStatus("changes_requested"),
      "需要修改 · Changes requested",
    );
    assert.equal(formatKnowledgeVisibility("team"), "团队 · Team");
    assert.equal(
      formatAssignedReviewerLabel(null),
      "未指定 · Reviewer Queue",
    );
  });
});
