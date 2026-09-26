import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateKnowledgePreviewConfig } from "./deploy-knowledge-preview.mjs";

const config = JSON.parse(
  readFileSync(new URL("../wrangler.knowledge-preview.jsonc", import.meta.url)),
);
const validInput = {
  config,
  branch: "feat/knowledge-smart-ingest-2",
  head: "db64ea13e16ca3358d4383e11248854048e4b2cf",
  approvedHead: "db64ea13e16ca3358d4383e11248854048e4b2cf",
  remoteHead: "db64ea13e16ca3358d4383e11248854048e4b2cf",
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


describe("SI2 Preview exact source and binding guard", () => {
  it("rejects missing/mismatched SHA, remote SHA, branch and dirty state", () => {
    for (const override of [{ approvedHead: undefined }, { approvedHead: "0".repeat(40) }, { remoteHead: "0".repeat(40) }, { branch: "main" }, { status: " M file" }]) {
      assert.throws(() => validateKnowledgePreviewConfig({ ...validInput, ...override }), /deployment blocked/);
    }
  });
  it("rejects shared AI, old Preview storage, unexpected bindings and unsafe flags", () => {
    for (const mutate of [
      c => { c.services[1].service = "crm-ai"; },
      c => { c.d1_databases[0].database_id = "14b75c29-3faf-4389-8aa8-48f06fa75355"; },
      c => { c.r2_buckets[0].bucket_name = "crm-knowledge-sources-preview"; },
      c => { c.kv_namespaces = []; },
      c => { c.services.push({ binding: "MAIL", service: "crm-system-mail-jobs-cron" }); },
      c => { c.vars.CRM_ALLOW_TEST_DB_BIND = "1"; },
      c => { c.vars.CRM_ALLOW_MOCK_AI = "1"; },
      c => { c.vars.MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE = "production"; },
      c => { c.vars.MAIL_OUTBOUND_TRANSPORT_MODE = "production"; },
      c => { c.vars.MAIL_LARGE_ATTACHMENT_SEND_ENABLED = "true"; },
      c => { c.services[0].environment = "other"; },
      c => { c.d1_databases[0].preview_database_id = "other"; },
      c => { c.vars.UNEXPECTED_SECRET = "synthetic"; },
    ]) {
      const mutated = structuredClone(config); mutate(mutated);
      assert.throws(() => validateKnowledgePreviewConfig({ ...validInput, config: mutated }), /deployment blocked/);
    }
  });
});
