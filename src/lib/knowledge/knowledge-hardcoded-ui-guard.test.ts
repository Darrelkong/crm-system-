import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

const ROOT = process.cwd();

const UI_ROOTS = [
  "src/components/knowledge",
  "src/app/(dashboard)/knowledge",
];

/** Previously hardcoded UI strings that must stay in locale dictionaries. */
const BANNED_LITERALS = [
  "返回 Knowledge",
  "返回文章",
  "资料整理",
  "來源整理",
  "审核中心",
  "審核中心",
  "编辑文章",
  "文章編輯",
  "确认批准并发布",
  "確認批准並發布",
  "要求修改",
  "撤回审核",
  "撤回審核",
  "提交审核",
  "送交審核",
  "查看文章",
  "快速查看",
  "版本历史",
  "版本記錄",
  "归档文章",
  "封存文章",
  "按标题或分类筛选",
  "未指定审核人的请求会进入可用审核者的待审核队列",
  "当前暂不支持一键恢复",
];

const ALLOWED_LINE_PATTERNS = [
  /^\s*\/\//,
  /^\s*\*/,
  /\bt\(/,
  /labelKey/,
  /titleKey/,
  /descriptionKey/,
  /key:\s*"/,
  /import\s+/,
  /from\s+"@\/i18n/,
];

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function isAllowedHardcodedLine(line: string): boolean {
  return ALLOWED_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

const ERROR_CLIENT_FILES = [
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

describe("Knowledge hardcoded UI guard", () => {
  it("does not render raw payload.error in Knowledge API clients", () => {
    const violations: string[] = [];
    for (const relative of ERROR_CLIENT_FILES) {
      const content = readFileSync(join(ROOT, relative), "utf8");
      if (content.includes("payload.error")) {
        violations.push(`${relative}: payload.error`);
      }
      if (
        !/resolveKnowledgeApiError|getKnowledgeErrorMessage/.test(content)
      ) {
        violations.push(`${relative}: missing centralized error mapper`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it("does not reintroduce known visible Chinese literals in Knowledge UI sources", () => {
    const violations: string[] = [];

    for (const root of UI_ROOTS) {
      for (const file of listSourceFiles(join(ROOT, root))) {
        const relative = file.slice(ROOT.length + 1);
        const content = readFileSync(file, "utf8");
        const lines = content.split("\n");

        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          if (isAllowedHardcodedLine(line)) continue;

          for (const literal of BANNED_LITERALS) {
            if (line.includes(literal)) {
              violations.push(`${relative}:${index + 1}: ${literal}`);
            }
          }

          if (/[\u4e00-\u9fff]/.test(line)) {
            violations.push(
              `${relative}:${index + 1}: unexpected Chinese characters in UI source`,
            );
          }
        }
      }
    }

    assert.deepEqual(violations, []);
  });
});
