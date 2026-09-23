import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHASE_PRIVATE_CLIENT_FIXTURE_TEXT } from "@/lib/knowledge/knowledge-evidence-grounding";
import {
  applyBusinessIdentityToOrganizerOutput,
  assessOrganizerIdentityConsistency,
  deriveKnowledgePasteBusinessIdentity,
} from "@/lib/knowledge/knowledge-paste-business-identity";
import { resolveKnowledgeCategoryIdForRequestedProject } from "@/lib/knowledge/knowledge-category-from-requested-project";

const HSBC_FIXTURE = `香港汇丰银行账户

一、资料要求
1. 身份证
2. 护照

二、资产要求
最低 50 万港币`;

describe("knowledge paste business identity", () => {
  it("A: HSBC evidence maps to HK banking taxonomy", () => {
    const identity = deriveKnowledgePasteBusinessIdentity(HSBC_FIXTURE);
    assert.equal(identity.requestedProjectCode, "hk_bank_account");
    assert.equal(identity.countryLabelZhHans, "香港");
    assert.match(identity.title, /汇丰/);
    assert.equal(identity.categoryMatch, "confident");
  });

  it("B: Chase evidence maps to US banking taxonomy", () => {
    const identity = deriveKnowledgePasteBusinessIdentity(
      CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
    );
    assert.equal(identity.requestedProjectCode, "us_bank_account");
    assert.equal(identity.countryLabelZhHans, "美国");
    assert.match(identity.title, /Chase Private Client/i);
    assert.equal(identity.categoryMatch, "confident");
  });

  it("C: Chase critical facts preserved in organizer body", () => {
    const applied = applyBusinessIdentityToOrganizerOutput(
      CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      {
        title: "wrong",
        summary: "s",
        body: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
        suggestedCategory: null,
        warnings: [],
      },
    );
    assert.match(applied.output.body, /60 天/);
    assert.match(applied.output.body, /15W/);
    assert.match(applied.output.body, /ACH/);
    assert.match(applied.output.body, /10 万美元/);
    assert.match(applied.output.body, /25 万美元/);
    assert.match(applied.output.body, /15,000/);
    assert.match(applied.output.body, /40,000/);
  });

  it("F: confident match resolves knowledge category id by CRM canonical name", () => {
    const id = resolveKnowledgeCategoryIdForRequestedProject(
      [
        { id: "cat-us", name: "美国银行账户", isActive: true },
        { id: "cat-hk", name: "香港银行账户", isActive: true },
      ],
      "us_bank_account",
    );
    assert.equal(id, "cat-us");
  });

  it("G: no match does not invent a knowledge category id", () => {
    const id = resolveKnowledgeCategoryIdForRequestedProject(
      [{ id: "cat-other", name: "其他分类", isActive: true }],
      "us_bank_account",
    );
    assert.equal(id, null);
  });

  it("I: contradictory title vs Chase body is inconsistent", () => {
    const identity = deriveKnowledgePasteBusinessIdentity(
      CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
    );
    const check = assessOrganizerIdentityConsistency({
      evidenceText: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      title: "香港汇丰银行账户",
      body: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
      identity,
    });
    assert.equal(check.consistent, false);
  });
});
