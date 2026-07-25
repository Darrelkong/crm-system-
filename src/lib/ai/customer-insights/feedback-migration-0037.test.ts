import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * Static + simulated rebuild checks for Migration 0037.
 * Does not touch Production D1.
 */
describe("Migration 0037 ai_insight_feedback phase5d", () => {
  const sql = readFileSync(
    "drizzle/migrations/0037_ai_insight_feedback_phase5d.sql",
    "utf8",
  );

  it("rebuilds with explicit column list (no SELECT *)", () => {
    assert.match(sql, /CREATE TABLE ai_insight_feedback_new/);
    assert.match(sql, /INSERT INTO ai_insight_feedback_new \(/);
    assert.doesNotMatch(sql, /SELECT \*/i);
    assert.match(sql, /DROP TABLE ai_insight_feedback/);
    assert.match(sql, /RENAME TO ai_insight_feedback/);
  });

  it("backfills legacy_overall and nullable rating_code", () => {
    assert.match(sql, /'legacy_overall'/);
    assert.match(sql, /rating_code/);
    assert.match(sql, /generation_key/);
    assert.match(
      sql,
      /trim\(ai_insight_id\) \|\| '\|' \|\| trim\(insight_generated_at\) \|\| '\|' \|\| trim\(source_hash\)/,
    );
  });

  it("creates partial unique indexes for legacy and component rows", () => {
    assert.match(
      sql,
      /uq_ai_insight_feedback_legacy_customer_generated[\s\S]*WHERE feedback_target = 'legacy_overall'/,
    );
    assert.match(
      sql,
      /uq_ai_insight_feedback_component_generation_actor_target[\s\S]*WHERE feedback_target IN \('base_deep', 'phase2', 'suggested_message'\)/,
    );
  });

  it("defines CHECK constraints for legacy/component mutual exclusion", () => {
    assert.match(sql, /CHECK \(/);
    assert.match(sql, /rating_code IS NULL/);
    assert.match(sql, /rating IS NULL/);
    assert.match(sql, /generation_key IS NOT NULL/);
  });

  it("rejects delimiter injection during generation_key backfill", () => {
    assert.match(sql, /instr\(trim\(ai_insight_id\), '\|'\) = 0/);
    assert.match(sql, /instr\(trim\(source_hash\), '\|'\) = 0/);
  });

  it("does not mutate insights, settings, usage, or audit tables", () => {
    assert.doesNotMatch(sql, /ALTER TABLE customer_ai_insights/i);
    assert.doesNotMatch(sql, /UPDATE\s+customer_ai_insights/i);
    assert.doesNotMatch(sql, /DROP TABLE customer_ai_insights/i);
    assert.doesNotMatch(sql, /system_settings/i);
    assert.doesNotMatch(sql, /ai_usage_events/i);
    assert.doesNotMatch(sql, /audit_logs/i);
    // FK reference to customer_ai_insights is expected and allowed.
    assert.match(sql, /REFERENCES customer_ai_insights\(id\)/);
  });

  it("adds snapshot columns without PII content fields", () => {
    for (const col of [
      "provider_snapshot",
      "contract_mode_snapshot",
      "phase2_generated_snapshot",
      "actor_role_snapshot",
      "degradation_reason_snapshot",
    ]) {
      assert.match(sql, new RegExp(col));
    }
    for (const bannedCol of [
      "customer_name TEXT",
      "phone TEXT",
      "email TEXT",
      "wechat",
      "prompt_text",
      "evidence_excerpt",
      "suggested_message TEXT",
      "raw_provider_response",
      "context_json",
    ]) {
      assert.doesNotMatch(sql, new RegExp(bannedCol, "i"));
    }
  });
});
