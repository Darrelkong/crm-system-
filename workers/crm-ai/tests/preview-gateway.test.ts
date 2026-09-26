import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { handleCrmAiRequest } from "../src/service";
import type { CrmAiEnv } from "../src/types";

describe("Preview gateway isolation", () => {
  for (const mode of [undefined, "direct"] as const) {
    it(`${mode ?? "default"} preserves the intended gateway boundary`, async () => {
      const options: unknown[] = [];
      const env: CrmAiEnv = {
        CRM_AI_GATEWAY_MODE: mode,
        AI: { run: async (_model: string, _input: unknown, option: unknown) => {
          options.push(option);
          return { response: { categoryId: null, confidenceBand: "low" } };
        } } as unknown as Ai,
      };
      const result = await handleCrmAiRequest(env, {
        task: "knowledge_category_suggest", schemaVersion: "knowledge-category-suggest-v1",
        locale: "en", systemPrompt: "Synthetic classification", userPrompt: "Synthetic evidence",
      });
      assert.equal(result.ok, true);
      assert.equal(options.length, 1);
      assert.deepEqual(options[0], mode === "direct" ? undefined : {
        gateway: { id: "default", collectLog: false,
          metadata: { task: "knowledge_category_suggest", schemaVersion: "knowledge-category-suggest-v1" } },
      });
    });
  }
});


it("Preview AI config exposes only Workers AI and the direct-mode variable", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.si2-preview.jsonc", import.meta.url), "utf8"));
  assert.equal(config.name, "crm-ai-si2-preview");
  assert.equal(config.account_id, "809c05c9f500268e973938fd641eee39");
  assert.deepEqual(config.ai, { binding: "AI" });
  assert.deepEqual(config.vars, { CRM_AI_GATEWAY_MODE: "direct" });
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  const allowed = new Set(["$schema", "name", "account_id", "main", "compatibility_date", "workers_dev", "preview_urls", "routes", "observability", "ai", "vars"]);
  assert.ok(Object.keys(config).every(key => allowed.has(key)));
  const production = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(production.vars?.CRM_AI_GATEWAY_MODE, undefined);
});
