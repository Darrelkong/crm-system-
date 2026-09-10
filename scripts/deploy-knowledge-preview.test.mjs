import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateKnowledgePreviewConfig } from "./deploy-knowledge-preview.mjs";

const config = JSON.parse(
  readFileSync(new URL("../wrangler.knowledge-preview.jsonc", import.meta.url)),
);
const validInput = {
  config,
  branch: "feat/knowledge-human-acceptance-preview",
  head: "db64ea13e16ca3358d4383e11248854048e4b2cf",
  status: "",
};

describe("Knowledge preview deployment guard", () => {
  it("accepts only the isolated preview configuration", () => {
    assert.equal(validateKnowledgePreviewConfig(validInput), true);
  });

  it("requires only the Preview custom domain", () => {
    for (const mutation of [
      (value) => {
        delete value.routes;
      },
      (value) => {
        value.routes[0].pattern = "preview.echfronthk.com";
      },
      (value) => {
        value.routes.push({
          pattern: "other-preview.echfronthk.com",
          custom_domain: true,
        });
      },
    ]) {
      const mutated = structuredClone(config);
      mutation(mutated);
      assert.throws(
        () =>
          validateKnowledgePreviewConfig({
            ...validInput,
            config: mutated,
          }),
        /deployment blocked/,
      );
    }
  });

  it("rejects production D1, R2, and route references", () => {
    for (const mutation of [
      (value) => {
        value.d1_databases[0].database_id =
          "03633dd2-c058-42de-9355-f5450eab7202";
      },
      (value) => {
        value.r2_buckets[0].bucket_name = "crm-attachments";
      },
      (value) => {
        value.routes = [{ pattern: "crm.echfronthk.com", custom_domain: true }];
      },
    ]) {
      const mutated = structuredClone(config);
      mutation(mutated);
      assert.throws(
        () =>
          validateKnowledgePreviewConfig({
            ...validInput,
            config: mutated,
          }),
        /deployment blocked/,
      );
    }
  });
});
