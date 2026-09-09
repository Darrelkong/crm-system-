import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseArticleInput,
  parseCategoryInput,
} from "@/lib/knowledge/core-service";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";

function assertInvalid(action: () => unknown, code = "KNOWLEDGE_ARTICLE_INVALID") {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof KnowledgeServiceError);
    assert.equal(error.errorCode, code);
    return true;
  });
}

describe("Knowledge Package 2 input validation", () => {
  it("requires safe category names and bounded sort order", () => {
    assert.deepEqual(
      parseCategoryInput({
        name: " 海外银行业务 ",
        description: "合成测试分类",
        sortOrder: 2,
      }),
      {
        name: "海外银行业务",
        description: "合成测试分类",
        sortOrder: 2,
      },
    );
    assertInvalid(
      () => parseCategoryInput({ name: "   " }),
      "KNOWLEDGE_CATEGORY_INVALID",
    );
    assertInvalid(
      () => parseCategoryInput({ name: "分类", sortOrder: -1 }),
      "KNOWLEDGE_CATEGORY_INVALID",
    );
  });

  it("requires title, category, body, and approved visibility", () => {
    assert.deepEqual(
      parseArticleInput({
        title: " 示例文章 ",
        categoryId: "category-1",
        summary: "",
        body: "正文",
        visibility: "team",
      }),
      {
        title: "示例文章",
        categoryId: "category-1",
        summary: null,
        body: "正文",
        visibility: "team",
        changeNote: null,
        expectedUpdatedAt: null,
      },
    );
    assertInvalid(() =>
      parseArticleInput({
        title: "",
        categoryId: "category-1",
        body: "正文",
      }),
    );
    assertInvalid(() =>
      parseArticleInput({
        title: "标题",
        categoryId: "category-1",
        body: "正文",
        visibility: "global",
      }),
    );
  });
});
