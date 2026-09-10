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
});
