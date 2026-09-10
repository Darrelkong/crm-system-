import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import {
  getKnowledgeErrorMessage,
  KNOWLEDGE_ERROR_I18N_KEYS,
  resolveKnowledgeApiError,
} from "@/lib/knowledge/error-messages";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

const tEn = (key: string) => {
  const parts = key.split(".");
  let value: unknown = en;
  for (const part of parts) {
    value = (value as Record<string, unknown>)[part];
  }
  return String(value);
};

const tHans = (key: string) => {
  const parts = key.split(".");
  let value: unknown = zhHans;
  for (const part of parts) {
    value = (value as Record<string, unknown>)[part];
  }
  return String(value);
};

const tHant = (key: string) => {
  const parts = key.split(".");
  let value: unknown = zhHant;
  for (const part of parts) {
    value = (value as Record<string, unknown>)[part];
  }
  return String(value);
};

const CLIENT_FILES = [
  "src/components/knowledge/knowledge-access-form.tsx",
  "src/components/knowledge/knowledge-ingest-client.tsx",
  "src/components/knowledge/knowledge-review-center-client.tsx",
  "src/components/knowledge/knowledge-article-editor.tsx",
  "src/components/knowledge/knowledge-review-actions.tsx",
  "src/components/knowledge/knowledge-article-archive-button.tsx",
  "src/components/knowledge/knowledge-categories-client.tsx",
  "src/components/knowledge/knowledge-members-client.tsx",
  "src/components/knowledge/knowledge-search-ai-panel.tsx",
];

describe("Knowledge error message localization", () => {
  it("maps every known Knowledge error code to a locale key", () => {
    for (const code of Object.values(KNOWLEDGE_ERROR_CODES)) {
      assert.ok(
        KNOWLEDGE_ERROR_I18N_KEYS[code],
        `missing i18n mapping for ${code}`,
      );
    }
  });

  it("localizes last-admin errors in Traditional Chinese", () => {
    assert.equal(
      getKnowledgeErrorMessage(tHant, KNOWLEDGE_ERROR_CODES.LAST_ADMIN),
      zhHant.knowledge.errors.lastAdmin,
    );
    assert.match(
      getKnowledgeErrorMessage(tHant, KNOWLEDGE_ERROR_CODES.LAST_ADMIN),
      /管理員/,
    );
  });

  it("localizes last-admin errors in Simplified Chinese", () => {
    assert.equal(
      getKnowledgeErrorMessage(tHans, KNOWLEDGE_ERROR_CODES.LAST_ADMIN),
      zhHans.knowledge.errors.lastAdmin,
    );
    assert.match(
      getKnowledgeErrorMessage(tHans, KNOWLEDGE_ERROR_CODES.LAST_ADMIN),
      /管理员/,
    );
  });

  it("localizes last-admin errors in English", () => {
    assert.equal(
      getKnowledgeErrorMessage(tEn, KNOWLEDGE_ERROR_CODES.LAST_ADMIN),
      en.knowledge.errors.lastAdmin,
    );
    assert.match(
      getKnowledgeErrorMessage(tEn, KNOWLEDGE_ERROR_CODES.LAST_ADMIN),
      /administrator/i,
    );
  });

  it("localizes wrong-password errors per locale", () => {
    assert.match(
      getKnowledgeErrorMessage(tHant, KNOWLEDGE_ERROR_CODES.PASSWORD_INVALID),
      /密碼錯誤/,
    );
    assert.match(
      getKnowledgeErrorMessage(tHans, KNOWLEDGE_ERROR_CODES.PASSWORD_INVALID),
      /密码错误/,
    );
    assert.match(
      getKnowledgeErrorMessage(tEn, KNOWLEDGE_ERROR_CODES.PASSWORD_INVALID),
      /Incorrect password/i,
    );
  });

  it("localizes lockout errors per locale", () => {
    assert.match(
      getKnowledgeErrorMessage(tHant, KNOWLEDGE_ERROR_CODES.PASSWORD_LOCKED),
      /稍後再試/,
    );
    assert.match(
      getKnowledgeErrorMessage(tHans, KNOWLEDGE_ERROR_CODES.PASSWORD_LOCKED),
      /稍后再试/,
    );
    assert.match(
      getKnowledgeErrorMessage(tEn, KNOWLEDGE_ERROR_CODES.PASSWORD_LOCKED),
      /Too many attempts/i,
    );
  });

  it("localizes source upload errors per locale", () => {
    assert.match(
      getKnowledgeErrorMessage(tHant, KNOWLEDGE_ERROR_CODES.SOURCE_INVALID),
      /來源/,
    );
    assert.match(
      getKnowledgeErrorMessage(tHans, KNOWLEDGE_ERROR_CODES.SOURCE_INVALID),
      /来源/,
    );
    assert.match(
      getKnowledgeErrorMessage(tEn, KNOWLEDGE_ERROR_CODES.SOURCE_INVALID),
      /Source information/i,
    );
  });

  it("localizes review errors per locale", () => {
    assert.match(
      getKnowledgeErrorMessage(tHant, KNOWLEDGE_ERROR_CODES.REVIEW_INVALID),
      /審核/,
    );
    assert.match(
      getKnowledgeErrorMessage(tHans, KNOWLEDGE_ERROR_CODES.REVIEW_INVALID),
      /审核/,
    );
    assert.match(
      getKnowledgeErrorMessage(tEn, KNOWLEDGE_ERROR_CODES.REVIEW_INVALID),
      /review action/i,
    );
  });

  it("localizes article conflict errors per locale", () => {
    assert.match(
      getKnowledgeErrorMessage(tHant, KNOWLEDGE_ERROR_CODES.ARTICLE_CONFLICT),
      /重新載入/,
    );
    assert.match(
      getKnowledgeErrorMessage(tHans, KNOWLEDGE_ERROR_CODES.ARTICLE_CONFLICT),
      /重新加载/,
    );
    assert.match(
      getKnowledgeErrorMessage(tEn, KNOWLEDGE_ERROR_CODES.ARTICLE_CONFLICT),
      /Reload and try again/i,
    );
  });

  it("localizes Knowledge AI unavailable errors per locale", () => {
    assert.match(
      getKnowledgeErrorMessage(tHant, KNOWLEDGE_ERROR_CODES.AI_PROVIDER_FAILED),
      /暫時無法使用/,
    );
    assert.match(
      getKnowledgeErrorMessage(tHans, KNOWLEDGE_ERROR_CODES.AI_PROVIDER_FAILED),
      /暂时无法使用/,
    );
    assert.match(
      getKnowledgeErrorMessage(tEn, KNOWLEDGE_ERROR_CODES.AI_PROVIDER_FAILED),
      /temporarily unavailable/i,
    );
  });

  it("falls back to localized generic errors for unknown codes", () => {
    assert.equal(
      getKnowledgeErrorMessage(tHant, "KNOWLEDGE_UNKNOWN_CODE"),
      zhHant.knowledge.errors.generic,
    );
    assert.equal(
      getKnowledgeErrorMessage(tHans, "KNOWLEDGE_UNKNOWN_CODE"),
      zhHans.knowledge.errors.generic,
    );
    assert.equal(
      getKnowledgeErrorMessage(tEn, "KNOWLEDGE_UNKNOWN_CODE"),
      en.knowledge.errors.generic,
    );
  });

  it("prefers error codes over raw backend messages in resolveKnowledgeApiError", () => {
    const localized = resolveKnowledgeApiError(tHant, {
      errorCode: KNOWLEDGE_ERROR_CODES.LAST_ADMIN,
      error: "至少需要保留一位 Knowledge 管理员",
    });
    assert.equal(localized, zhHant.knowledge.errors.lastAdmin);
    assert.doesNotMatch(localized, /管理员/);
  });

  it("keeps Knowledge clients from rendering payload.error directly", () => {
    for (const file of CLIENT_FILES) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      assert.match(
        source,
        /resolveKnowledgeApiError|getKnowledgeErrorMessage/,
        `${file} must use centralized Knowledge error mapping`,
      );
      assert.doesNotMatch(
        source,
        /payload\.error/,
        `${file} must not render payload.error directly`,
      );
    }
  });
});
