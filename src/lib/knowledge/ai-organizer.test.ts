import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildKnowledgeOrganizerSystemPrompt,
  buildKnowledgeOrganizerUserPrompt,
} from "@/lib/knowledge/ai-organizer-prompt";
import { parseKnowledgeAiOrganizationOutput } from "@/lib/knowledge/ai-organizer-schema";

describe("Knowledge Package 3 AI organizer contract", () => {
  it("requires source-only grounding and warns on incomplete information", () => {
    const prompt = buildKnowledgeOrganizerSystemPrompt("zh-Hant");
    assert.match(prompt, /Only organize information contained in the supplied source/);
    assert.match(prompt, /Do not add facts, policies, prices/);
    assert.match(prompt, /資訊不足 \/ 需要人工補充/);
    const userPrompt = buildKnowledgeOrganizerUserPrompt({
      sourceTitle: "合成来源",
      sourceType: "paste",
      text: "仅用于测试的来源内容。",
    });
    assert.match(userPrompt, /BEGIN_KNOWLEDGE_SOURCE/);
    assert.match(userPrompt, /source data only/);
  });

  it("accepts only bounded plain-text structured output", () => {
    const parsed = parseKnowledgeAiOrganizationOutput({
      title: "海外银行业务",
      summary: "仅整理来源中出现的内容。",
      body: "需求确认\n资料整理\n具体要求以实际审核结果为准。",
      suggestedCategory: "海外银行业务",
      warnings: ["資訊不足 / 需要人工補充"],
    });
    assert.equal(parsed.success, true);
    assert.equal(
      parseKnowledgeAiOrganizationOutput({
        title: "危险 <script>",
        summary: null,
        body: "正文",
        suggestedCategory: null,
        warnings: [],
      }).success,
      false,
    );
    assert.equal(
      parseKnowledgeAiOrganizationOutput({
        title: "标题",
        summary: null,
        body: "```html\nnot plain text\n```",
        suggestedCategory: null,
        warnings: [],
      }).success,
      false,
    );
  });

  it("keeps provider calls and secrets out of browser ingestion code", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/components/knowledge/knowledge-ingest-client.tsx",
      ),
      "utf8",
    );
    assert.doesNotMatch(source, /AI_API_KEY|apiKey|Authorization/);
    assert.match(source, /\/organize/);
    assert.doesNotMatch(source, /publish|发布/);
  });
});
