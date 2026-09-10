import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import en from "@/i18n/locales/en";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const HOME_KEYS = [
  "pageDescription",
  "browseHint",
  "confidentialityNotice",
  "newDraft",
  "ingest",
  "myReviews",
  "reviewCenter",
  "lockKnowledge",
  "categories",
  "allArticles",
  "manageCategories",
  "categoryName",
  "categoryDescription",
  "addCategory",
  "emptyCategory",
] as const;

const MEMBERS_KEYS = [
  "saveChanges",
  "unsavedChanges",
  "youBadge",
  "knowledgeAdminBadge",
  "lastAdminReadonly",
  "lastAdminError",
] as const;

const ROLE_KEYS = [
  "viewer",
  "contributor",
  "reviewer",
  "knowledge_admin",
] as const;

const INGEST_KEYS = [
  "pageTitle",
  "description",
  "pasteTab",
  "fileTab",
  "createSource",
  "organize",
  "saveDraft",
  "noSources",
] as const;

const REVIEW_KEYS = [
  "pageTitle",
  "centerDescription",
  "pending",
  "mine",
  "history",
  "approvePublish",
  "requestChanges",
  "viewArticle",
  "confirmApprovePublish",
  "emptyList",
] as const;

const ARTICLE_KEYS = [
  "editTitle",
  "saveDraft",
  "archiveArticle",
  "confirmArchive",
  "submitReview",
  "withdrawReview",
  "historyTitle",
  "historyDescription",
  "editArticle",
  "ingestChangeNote",
] as const;

function collectLeafKeys(
  value: Record<string, unknown>,
  prefix = "",
): string[] {
  const keys: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      keys.push(...collectLeafKeys(child as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function assertKnowledgeKeyParity() {
  const enKeys = collectLeafKeys(en.knowledge as Record<string, unknown>);
  const hansKeys = collectLeafKeys(zhHans.knowledge as Record<string, unknown>);
  const hantKeys = collectLeafKeys(zhHant.knowledge as Record<string, unknown>);
  assert.deepEqual(
    [...hansKeys].sort(),
    [...enKeys].sort(),
    "zh-Hans knowledge keys must match en",
  );
  assert.deepEqual(
    [...hantKeys].sort(),
    [...enKeys].sort(),
    "zh-Hant knowledge keys must match en",
  );
}

describe("Knowledge i18n", () => {
  it("defines home keys in zh-Hans, zh-Hant, and en", () => {
    for (const key of HOME_KEYS) {
      assert.ok(zhHans.knowledge.home[key], `zh-Hans missing knowledge.home.${key}`);
      assert.ok(zhHant.knowledge.home[key], `zh-Hant missing knowledge.home.${key}`);
      assert.ok(en.knowledge.home[key], `en missing knowledge.home.${key}`);
    }
  });

  it("defines members batch-save keys in all locales", () => {
    for (const key of MEMBERS_KEYS) {
      assert.ok(zhHans.knowledge.members[key], `zh-Hans missing knowledge.members.${key}`);
      assert.ok(zhHant.knowledge.members[key], `zh-Hant missing knowledge.members.${key}`);
      assert.ok(en.knowledge.members[key], `en missing knowledge.members.${key}`);
    }
  });

  it("localizes role labels per locale", () => {
    for (const role of ROLE_KEYS) {
      assert.ok(zhHans.knowledge.members.roles[role]);
      assert.ok(zhHant.knowledge.members.roles[role]);
      assert.ok(en.knowledge.members.roles[role]);
    }
    assert.equal(zhHant.knowledge.members.roles.contributor, "內容編輯");
    assert.equal(zhHant.knowledge.members.roles.reviewer, "審核人員");
    assert.equal(zhHans.knowledge.members.roles.contributor, "内容编辑");
    assert.equal(en.knowledge.members.roles.knowledge_admin, "Knowledge Administrator");
  });

  it("uses Traditional Chinese in zh-Hant confidentiality notice", () => {
    assert.match(zhHant.knowledge.home.confidentialityNotice, /保密提醒/);
    assert.match(zhHant.knowledge.home.confidentialityNotice, /內部資料/);
    assert.doesNotMatch(zhHant.knowledge.home.confidentialityNotice, /内部资料/);
  });

  it("uses Simplified Chinese in zh-Hans confidentiality notice", () => {
    assert.match(zhHans.knowledge.home.confidentialityNotice, /保密提醒/);
    assert.match(zhHans.knowledge.home.confidentialityNotice, /内部资料/);
  });

  it("uses English in en confidentiality notice", () => {
    assert.match(en.knowledge.home.confidentialityNotice, /Confidentiality Notice/);
  });

  it("wires Knowledge home and search clients to translation keys", () => {
    const home = read("src/components/knowledge/knowledge-home-client.tsx");
    const search = read("src/components/knowledge/knowledge-search-ai-panel.tsx");
    const members = read("src/components/knowledge/knowledge-members-client.tsx");

    assert.match(home, /knowledge\.home\./);
    assert.match(home, /knowledge\.home\.confidentialityNotice/);
    assert.doesNotMatch(home, /新建草稿|业务知识库|按分类浏览/);

    assert.match(search, /knowledge\.searchAi\./);
    assert.doesNotMatch(search, /搜索 Knowledge|只会根据已发布/);

    assert.match(members, /knowledge\.members\.saveChanges/);
    assert.match(members, /knowledge\.members\.youBadge/);
    assert.doesNotMatch(members, /saveRole\(member\.id\)/);
  });

  it("keeps knowledge namespace key parity across en, zh-Hans, and zh-Hant", () => {
    assertKnowledgeKeyParity();
  });

  it("defines knowledge.errors keys in all locales", () => {
    const errorKeys = Object.keys(en.knowledge.errors) as Array<
      keyof typeof en.knowledge.errors
    >;
    assert.ok(errorKeys.length > 0);
    for (const key of errorKeys) {
      assert.ok(zhHans.knowledge.errors[key], `zh-Hans missing knowledge.errors.${key}`);
      assert.ok(zhHant.knowledge.errors[key], `zh-Hant missing knowledge.errors.${key}`);
    }
  });

  it("defines ingest, review, and article keys in all locales", () => {
    for (const key of INGEST_KEYS) {
      assert.ok(zhHans.knowledge.ingest[key], `zh-Hans missing knowledge.ingest.${key}`);
      assert.ok(zhHant.knowledge.ingest[key], `zh-Hant missing knowledge.ingest.${key}`);
      assert.ok(en.knowledge.ingest[key], `en missing knowledge.ingest.${key}`);
    }
    for (const key of REVIEW_KEYS) {
      assert.ok(zhHans.knowledge.review[key], `zh-Hans missing knowledge.review.${key}`);
      assert.ok(zhHant.knowledge.review[key], `zh-Hant missing knowledge.review.${key}`);
      assert.ok(en.knowledge.review[key], `en missing knowledge.review.${key}`);
    }
    for (const key of ARTICLE_KEYS) {
      assert.ok(zhHans.knowledge.article[key], `zh-Hans missing knowledge.article.${key}`);
      assert.ok(zhHant.knowledge.article[key], `zh-Hant missing knowledge.article.${key}`);
      assert.ok(en.knowledge.article[key], `en missing knowledge.article.${key}`);
    }
  });

  it("uses Traditional Chinese on zh-Hant secondary Knowledge pages", () => {
    assert.match(zhHant.knowledge.home.ingest, /來源整理/);
    assert.match(zhHant.knowledge.review.pageTitle, /審核中心/);
    assert.match(zhHant.knowledge.article.editArticle, /文章編輯/);
    assert.match(zhHant.knowledge.article.historyTitle, /版本記錄/);
    assert.match(zhHant.knowledge.article.archiveArticle, /封存/);
    assert.match(zhHant.knowledge.article.submitReview, /送交審核/);
    assert.match(zhHant.knowledge.article.saveDraft, /儲存草稿/);
    assert.doesNotMatch(zhHant.knowledge.home.confidentialityNotice, /内部资料/);
    assert.doesNotMatch(zhHant.knowledge.members.roles.contributor, /内容编辑/);
  });

  it("uses Simplified Chinese on zh-Hans secondary Knowledge pages", () => {
    assert.match(zhHans.knowledge.home.ingest, /来源整理/);
    assert.match(zhHans.knowledge.review.pageTitle, /审核中心/);
    assert.match(zhHans.knowledge.article.editArticle, /编辑文章/);
    assert.match(zhHans.knowledge.article.historyTitle, /版本历史/);
    assert.match(zhHans.knowledge.article.archiveArticle, /归档/);
    assert.match(zhHans.knowledge.article.submitReview, /提交审核/);
    assert.match(zhHans.knowledge.article.saveDraft, /保存草稿/);
    assert.doesNotMatch(zhHans.knowledge.home.confidentialityNotice, /內部資料/);
    assert.doesNotMatch(zhHans.knowledge.members.roles.contributor, /內容編輯/);
  });

  it("uses English on en secondary Knowledge pages", () => {
    assert.match(en.knowledge.home.ingest, /Source ingest/i);
    assert.match(en.knowledge.review.pageTitle, /Review Center/);
    assert.match(en.knowledge.article.editArticle, /Edit article/i);
    assert.match(en.knowledge.article.historyTitle, /Version history/i);
    assert.match(en.knowledge.article.archiveArticle, /Archive article/i);
    assert.match(en.knowledge.article.submitReview, /Submit for review/i);
    assert.match(en.knowledge.article.saveDraft, /Save draft/i);
  });

  it("wires ingest, review, editor, history, and archive UI to translation keys", () => {
    const ingest = read("src/components/knowledge/knowledge-ingest-client.tsx");
    const review = read("src/components/knowledge/knowledge-review-center-client.tsx");
    const editor = read("src/components/knowledge/knowledge-article-editor.tsx");
    const history = read("src/components/knowledge/knowledge-article-history-client.tsx");
    const archive = read("src/components/knowledge/knowledge-article-archive-button.tsx");

    assert.match(ingest, /knowledge\.ingest\./);
    assert.match(review, /knowledge\.review\./);
    assert.match(editor, /knowledge\.article\./);
    assert.match(history, /knowledge\.article\./);
    assert.match(archive, /knowledge\.article\.archiveArticle/);
    assert.doesNotMatch(ingest, /资料整理|來源整理/);
    assert.doesNotMatch(review, /审核中心|審核中心/);
    assert.doesNotMatch(editor, /编辑文章|文章編輯/);
  });
});
