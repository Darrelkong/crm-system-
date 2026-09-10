import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const HOME_ACTION_KEYS = [
  "newDraft",
  "ingest",
  "reviewCenter",
] as const;

const NEW_HOME_KEYS = [
  "manageCategoriesLink",
  "articlesHeading",
  "noArticlesYet",
  "createFirstDraft",
] as const;

const NEW_MEMBERS_KEYS = [
  "soleAdminProtected",
  "roleChooserTitle",
  "searchPlaceholder",
  "filterAll",
  "filterUnassigned",
  "pendingCount",
  "cancelChanges",
] as const;

const NEW_SEARCH_KEYS = ["modeLabel"] as const;

const NEW_CATEGORY_KEYS = ["pageTitle", "description", "backToKnowledge"] as const;

describe("Knowledge mobile visual polish v2", () => {
  it("HOME A: mobile actions contain the four primary admin actions", () => {
    const home = read("src/components/knowledge/knowledge-home-client.tsx");
    for (const key of [...HOME_ACTION_KEYS, "members"]) {
      assert.match(home, new RegExp(`key: "${key}"`));
    }
    assert.match(home, /data-home-action=\{action\.key\}/);
    assert.match(home, /grid-cols-2/);
  });

  it("HOME B: category creation form is not rendered on Home", () => {
    const home = read("src/components/knowledge/knowledge-home-client.tsx");
    assert.doesNotMatch(home, /function createCategory/);
    assert.doesNotMatch(home, /knowledge\.home\.categoryName/);
    assert.doesNotMatch(home, /knowledge\.home\.addCategory/);
    assert.doesNotMatch(home, /onSubmit={createCategory}/);
  });

  it("HOME C: category management link exists for authorized admin", () => {
    const home = read("src/components/knowledge/knowledge-home-client.tsx");
    assert.match(home, /data-category-manage-link="true"/);
    assert.match(home, /\/knowledge\/categories/);
    assert.match(home, /role === "knowledge_admin"/);
  });

  it("HOME D: Lock Knowledge remains available", () => {
    const home = read("src/components/knowledge/knowledge-home-client.tsx");
    assert.match(home, /data-home-lock="true"/);
    assert.match(home, /knowledge\.home\.lockKnowledge/);
    assert.match(home, /\/api\/knowledge\/lock/);
  });

  it("HOME E: confidentiality notice preserved", () => {
    const home = read("src/components/knowledge/knowledge-home-client.tsx");
    assert.match(home, /knowledge\.home\.confidentialityNotice/);
    assert.match(home, /role="note"/);
  });

  it("HOME: compact empty article state", () => {
    const home = read("src/components/knowledge/knowledge-home-client.tsx");
    assert.match(home, /data-home-empty-articles="true"/);
    assert.match(home, /knowledge\.home\.noArticlesYet/);
    assert.match(home, /knowledge\.home\.createFirstDraft/);
  });

  it("MEMBERS F: member rows render compact list structure", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.match(client, /data-member-list="true"/);
    assert.match(client, /data-member-row="true"/);
    assert.match(client, /knowledgeDisplayInitials/);
    assert.doesNotMatch(client, /<Card[\s\S]*data-member-row/);
  });

  it("MEMBERS G: permanent native role selects are not rendered", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.doesNotMatch(client, /<select/);
    assert.doesNotMatch(client, /KNOWLEDGE_ROLES\.map[\s\S]*<option/);
  });

  it("MEMBERS H: current user indicator exists", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.match(client, /data-you-badge="true"/);
    assert.match(client, /knowledge\.members\.youBadge/);
  });

  it("MEMBERS I/J: sole admin protected state blocks role chooser", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.match(client, /data-sole-admin-protected="true"/);
    assert.match(client, /isLastAdminLocked/);
    assert.match(client, /knowledge\.members\.soleAdminProtected/);
    assert.match(client, /data-member-editable="false"/);
    assert.match(client, /setEditingMemberId\(member\.id\)/);
  });

  it("MEMBERS K/L: editable member role chooser updates local pending state", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.match(client, /data-role-chooser="true"/);
    assert.match(client, /KnowledgeMobileSheet/);
    assert.match(client, /function selectRole\(/);
    assert.match(client, /setDrafts/);
    assert.match(client, /setEditingMemberId\(null\)/);
  });

  it("MEMBERS M/N: batch save preserved with pending bar", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.match(client, /savePendingChanges/);
    assert.match(client, /pendingChanges/);
    assert.match(client, /data-pending-save-bar="true"/);
    assert.match(client, /hasPendingChanges &&/);
    assert.match(client, /bottom-\[calc\(env\(safe-area-inset-bottom/);
  });

  it("MEMBERS: client-side member search and filter", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.match(client, /knowledge\.members\.searchPlaceholder/);
    assert.match(client, /knowledge\.members\.filterAll/);
    assert.match(client, /knowledge\.members\.filterUnassigned/);
    assert.doesNotMatch(client, /\/api\/knowledge\/roles\?/);
  });

  it("I18N O: new labels exist in en / zh-Hans / zh-Hant", () => {
    for (const key of NEW_HOME_KEYS) {
      assert.ok(en.knowledge.home[key], `en missing knowledge.home.${key}`);
      assert.ok(zhHans.knowledge.home[key], `zh-Hans missing knowledge.home.${key}`);
      assert.ok(zhHant.knowledge.home[key], `zh-Hant missing knowledge.home.${key}`);
    }
    for (const key of NEW_MEMBERS_KEYS) {
      assert.ok(en.knowledge.members[key], `en missing knowledge.members.${key}`);
      assert.ok(
        zhHans.knowledge.members[key],
        `zh-Hans missing knowledge.members.${key}`,
      );
      assert.ok(
        zhHant.knowledge.members[key],
        `zh-Hant missing knowledge.members.${key}`,
      );
    }
    for (const key of NEW_SEARCH_KEYS) {
      assert.ok(en.knowledge.searchAi[key], `en missing knowledge.searchAi.${key}`);
      assert.ok(
        zhHans.knowledge.searchAi[key],
        `zh-Hans missing knowledge.searchAi.${key}`,
      );
      assert.ok(
        zhHant.knowledge.searchAi[key],
        `zh-Hant missing knowledge.searchAi.${key}`,
      );
    }
    for (const key of NEW_CATEGORY_KEYS) {
      assert.ok(en.knowledge.categories[key], `en missing knowledge.categories.${key}`);
      assert.ok(
        zhHans.knowledge.categories[key],
        `zh-Hans missing knowledge.categories.${key}`,
      );
      assert.ok(
        zhHant.knowledge.categories[key],
        `zh-Hant missing knowledge.categories.${key}`,
      );
    }
  });

  it("categories page reuses existing category API without schema change", () => {
    const page = read("src/app/(dashboard)/knowledge/categories/page.tsx");
    const client = read("src/components/knowledge/knowledge-categories-client.tsx");
    assert.match(page, /status\.role !== "knowledge_admin"/);
    assert.match(client, /\/api\/knowledge\/categories/);
    assert.match(client, /createCategory/);
    assert.doesNotMatch(page, /drizzle\/migrations/);
  });

});
